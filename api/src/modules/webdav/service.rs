use crate::core::error::ApiError;
use chrono::{DateTime, Utc};
use quick_xml::{Reader, events::Event};
use reqwest::{Client, Method, RequestBuilder, Url};
use std::{
    collections::{HashSet, VecDeque},
    time::Duration,
};
use tokio::task::JoinSet;

#[derive(Debug, Clone)]
pub struct WebDavFile {
    pub remote_url: String,
    pub file_size: i64,
    pub modified_at: Option<DateTime<Utc>>,
    pub etag: Option<String>,
}

#[derive(Clone)]
pub struct WebDavClient {
    client: Client,
    base: Url,
    username: String,
    password: String,
}

impl WebDavClient {
    pub fn new(
        url: &str,
        username: impl Into<String>,
        password: impl Into<String>,
    ) -> Result<Self, ApiError> {
        let base = normalize_base_url(url)?;
        Ok(Self {
            client: build_client()?,
            base,
            username: username.into(),
            password: password.into(),
        })
    }

    pub async fn validate_connection(&self) -> Result<(), ApiError> {
        let response = self
            .request(
                Method::from_bytes(b"PROPFIND").expect("valid WebDAV method"),
                self.base.clone(),
            )
            .header("Depth", "0")
            .send()
            .await
            .map_err(|error| ApiError::BadRequest(format!("WebDAV connection failed: {error}")))?;
        if !response.status().is_success() && response.status().as_u16() != 207 {
            return Err(ApiError::BadRequest(format!(
                "WebDAV server returned {}",
                response.status()
            )));
        }
        Ok(())
    }

    pub async fn list_directory(&self, remote_path: &str) -> Result<Vec<WebDavFile>, ApiError> {
        const LIST_CONCURRENCY: usize = 8;
        let root = self.directory_url(remote_path)?;
        let mut directories = VecDeque::from([root.clone()]);
        let mut files = Vec::new();
        let mut visited = HashSet::new();
        let mut requests = JoinSet::new();
        while !directories.is_empty() || !requests.is_empty() {
            while requests.len() < LIST_CONCURRENCY {
                let Some(directory) = directories.pop_front() else {
                    break;
                };
                if !visited.insert(directory.as_str().to_owned()) {
                    continue;
                }
                let client = self.clone();
                requests.spawn(async move {
                    let items = client.list_directory_level(directory.clone()).await?;
                    Ok::<_, ApiError>((directory, items))
                });
            }

            let Some(result) = requests.join_next().await else {
                continue;
            };
            let (directory, items) = result.map_err(|error| {
                ApiError::BadRequest(format!("WebDAV listing task failed: {error}"))
            })??;
            for listed in items {
                let item = directory
                    .join(&listed.href)
                    .map_err(|_| ApiError::BadRequest("invalid WebDAV response path".to_owned()))?;
                self.ensure_in_base(&item)?;
                if item == directory {
                    continue;
                }
                if listed.is_collection {
                    directories.push_back(as_directory_url(item)?);
                } else {
                    files.push(WebDavFile {
                        remote_url: item.to_string(),
                        file_size: listed.file_size.unwrap_or_default(),
                        modified_at: listed.modified_at,
                        etag: listed.etag,
                    });
                }
            }
        }
        Ok(files)
    }

    async fn list_directory_level(
        &self,
        directory: Url,
    ) -> Result<Vec<WebDavListingEntry>, ApiError> {
        const PROPFIND_PROPERTIES: &str = r#"<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/><D:getcontentlength/><D:getlastmodified/><D:getetag/></D:prop></D:propfind>"#;
        let response = self
            .request(
                Method::from_bytes(b"PROPFIND").expect("valid WebDAV method"),
                directory.clone(),
            )
            .header("Depth", "1")
            .header("Content-Type", "application/xml; charset=utf-8")
            .body(PROPFIND_PROPERTIES)
            .send()
            .await
            .map_err(|error| ApiError::BadRequest(format!("WebDAV listing failed: {error}")))?;
        if response.status().as_u16() != 207 {
            return Err(ApiError::BadRequest(format!(
                "WebDAV listing returned {} for {}",
                response.status(),
                directory
            )));
        }
        parse_multistatus(
            &response
                .text()
                .await
                .map_err(|error| ApiError::BadRequest(error.to_string()))?,
        )
    }

    pub async fn get_content(
        &self,
        locator: &str,
        range: Option<&str>,
    ) -> Result<reqwest::Response, ApiError> {
        let target = Url::parse(locator)
            .map_err(|_| ApiError::BadRequest("invalid WebDAV media locator".to_owned()))?;
        self.ensure_in_base(&target)?;
        let mut request = self.request(Method::GET, target);
        if let Some(range) = range {
            request = request.header("Range", range);
        }
        request.send().await.map_err(|error| {
            ApiError::BadRequest(format!("WebDAV content request failed: {error}"))
        })
    }

    fn request(&self, method: Method, url: Url) -> RequestBuilder {
        self.client
            .request(method, url)
            .basic_auth(&self.username, Some(&self.password))
    }

    fn directory_url(&self, remote_path: &str) -> Result<Url, ApiError> {
        let path = remote_path.trim_matches('/');
        if path.split('/').any(|segment| segment == "..") || path.contains('\\') {
            return Err(ApiError::BadRequest("invalid WebDAV path".to_owned()));
        }

        let target = self
            .base
            .join(path)
            .map_err(|_| ApiError::BadRequest("invalid WebDAV path".to_owned()))?;
        self.ensure_in_base(&target)?;
        as_directory_url(target)
    }

    fn ensure_in_base(&self, target: &Url) -> Result<(), ApiError> {
        if target.scheme() != self.base.scheme()
            || target.host_str() != self.base.host_str()
            || target.port_or_known_default() != self.base.port_or_known_default()
            || !target.path().starts_with(self.base.path())
        {
            return Err(ApiError::BadRequest(
                "WebDAV resource is outside the configured connection root".to_owned(),
            ));
        }
        Ok(())
    }
}

fn normalize_base_url(value: &str) -> Result<Url, ApiError> {
    let mut base = Url::parse(value.trim())
        .map_err(|_| ApiError::BadRequest("invalid WebDAV URL".to_owned()))?;
    if !matches!(base.scheme(), "http" | "https")
        || base.host_str().is_none()
        || base.query().is_some()
        || base.fragment().is_some()
        || !base.username().is_empty()
        || base.password().is_some()
    {
        return Err(ApiError::BadRequest("invalid WebDAV URL".to_owned()));
    }
    if !base.path().ends_with('/') {
        let path = format!("{}/", base.path());
        base.set_path(&path);
    }
    Ok(base)
}

fn as_directory_url(mut url: Url) -> Result<Url, ApiError> {
    if !url.path().ends_with('/') {
        let path = format!("{}/", url.path());
        url.set_path(&path);
    }
    Ok(url)
}

fn build_client() -> Result<Client, ApiError> {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .pool_max_idle_per_host(8)
        .build()
        .map_err(|error| {
            ApiError::BadRequest(format!("WebDAV client initialization failed: {error}"))
        })
}

#[derive(Debug, PartialEq)]
struct WebDavListingEntry {
    href: String,
    is_collection: bool,
    file_size: Option<i64>,
    modified_at: Option<DateTime<Utc>>,
    etag: Option<String>,
}

fn parse_multistatus(xml: &str) -> Result<Vec<WebDavListingEntry>, ApiError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();
    let mut href = None;
    let mut in_href = false;
    let mut collection = false;
    let mut file_size = None;
    let mut in_content_length = false;
    let mut modified_at = None;
    let mut in_last_modified = false;
    let mut etag = None;
    let mut in_etag = false;
    let mut result = Vec::new();
    let mut element_depth = 0_usize;
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) => {
                element_depth += 1;
                match event.local_name().as_ref() {
                    b"response" => {
                        href = None;
                        collection = false;
                        file_size = None;
                        modified_at = None;
                        etag = None;
                    }
                    b"href" => in_href = true,
                    b"collection" => collection = true,
                    b"getcontentlength" => in_content_length = true,
                    b"getlastmodified" => in_last_modified = true,
                    b"getetag" => in_etag = true,
                    _ => {}
                }
            }
            Ok(Event::Empty(event)) if event.local_name().as_ref() == b"collection" => {
                collection = true
            }
            Ok(Event::Text(text)) if in_href => {
                href = Some(
                    text.unescape()
                        .map(|value| value.into_owned())
                        .unwrap_or_else(|_| String::from_utf8_lossy(text.as_ref()).into_owned()),
                );
            }
            Ok(Event::Text(text)) if in_content_length => {
                file_size = text.unescape().ok().and_then(|value| value.parse().ok());
            }
            Ok(Event::Text(text)) if in_last_modified => {
                modified_at = text
                    .unescape()
                    .ok()
                    .and_then(|value| DateTime::parse_from_rfc2822(&value).ok())
                    .map(|value| value.with_timezone(&Utc));
            }
            Ok(Event::Text(text)) if in_etag => {
                etag = text.unescape().ok().map(|value| value.into_owned());
            }
            Ok(Event::End(event)) => {
                element_depth = element_depth.saturating_sub(1);
                match event.local_name().as_ref() {
                    b"href" => in_href = false,
                    b"getcontentlength" => in_content_length = false,
                    b"getlastmodified" => in_last_modified = false,
                    b"getetag" => in_etag = false,
                    b"response" => {
                        if let Some(value) = href.take() {
                            result.push(WebDavListingEntry {
                                href: value,
                                is_collection: collection,
                                file_size,
                                modified_at,
                                etag: etag.clone(),
                            });
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) if element_depth == 0 => break,
            Ok(Event::Eof) => {
                return Err(ApiError::BadRequest(
                    "invalid WebDAV multistatus response: unexpected end of XML".to_owned(),
                ));
            }
            Err(error) => {
                return Err(ApiError::BadRequest(format!(
                    "invalid WebDAV multistatus response: {error}"
                )));
            }
            _ => {}
        }
        buffer.clear();
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::{WebDavClient, parse_multistatus};
    use reqwest::Url;

    #[test]
    fn parses_empty_collection_elements_as_directories() {
        let items = parse_multistatus(
            r#"<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/home/Photos/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response><d:response><d:href>/home/Photos/picture.jpg</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response></d:multistatus>"#,
        )
        .unwrap();
        assert!(items[0].is_collection);
        assert_eq!(items[1].href, "/home/Photos/picture.jpg");
    }

    #[test]
    fn unescapes_xml_entities_in_webdav_hrefs() {
        let items = parse_multistatus(
            r#"<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/home/Photos/%F0%9F%8D%96%20COS&amp;%E7%9C%9F%E4%BA%BA%E7%BE%8E%E5%9B%BE/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>"#,
        )
        .unwrap();

        assert_eq!(
            items[0].href,
            "/home/Photos/%F0%9F%8D%96%20COS&%E7%9C%9F%E4%BA%BA%E7%BE%8E%E5%9B%BE/"
        );
    }

    #[test]
    fn parses_file_metadata() {
        let items = parse_multistatus(
            r#"<d:multistatus xmlns:d="DAV:"><d:response><d:href>/home/Photos/picture.jpg</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>1024</d:getcontentlength><d:getlastmodified>Wed, 01 Jan 2025 12:00:00 GMT</d:getlastmodified><d:getetag>"f2a9"</d:getetag></d:prop></d:propstat></d:response></d:multistatus>"#,
        )
        .unwrap();
        assert_eq!(items[0].file_size, Some(1024));
        assert_eq!(
            items[0].modified_at.map(|value| value.to_rfc3339()),
            Some("2025-01-01T12:00:00+00:00".to_owned())
        );
        assert_eq!(items[0].etag.as_deref(), Some("\"f2a9\""));
    }

    #[test]
    fn rejects_paths_that_escape_the_configured_root() {
        let client =
            WebDavClient::new("https://dav.example.test/root", "user", "password").unwrap();

        assert!(client.directory_url("albums/2025").is_ok());
        assert!(client.directory_url("../private").is_err());
        assert!(
            client
                .ensure_in_base(&Url::parse("https://dav.example.test/private/file.jpg").unwrap())
                .is_err()
        );
        assert!(
            client
                .ensure_in_base(&Url::parse("https://other.example.test/root/file.jpg").unwrap())
                .is_err()
        );
    }

    #[test]
    fn returns_an_error_for_malformed_multistatus_xml() {
        assert!(parse_multistatus("<d:multistatus>").is_err());
    }
}
