export default function Head() {
  return (
    <header
      className="sticky top-0 z-40 flex h-12 shrink-0 items-center px-3 backdrop-blur-md"
      style={{
        borderBottom: "1px solid var(--theme-border-light)",
        backgroundColor: "var(--theme-bg-header)",
      }}
    >
      <div className="rounded-full px-3 py-1 text-sm font-medium shadow-sm" style={{ backgroundColor: "var(--theme-bg-card)", color: "var(--theme-text-secondary)" }}>
        头部
      </div>
    </header>
  );
}
