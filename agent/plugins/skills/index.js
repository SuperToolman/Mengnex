export function createPlugin(config) {
  const skills = Array.isArray(config.skills) ? config.skills : [];
  return {
    name: "mengnex-skills-package",
    inject: ["agentContext"],
    apply(ctx) {
      const cleanups = skills.map((skill) => {
        if (!skill || typeof skill.id !== "string" || typeof skill.instruction !== "string") {
          throw new Error("each skill needs an id and instruction");
        }
        return ctx.agentContext.register(`skill:${skill.id}`, skill.instruction);
      });
      return () => cleanups.reverse().forEach((cleanup) => cleanup());
    },
  };
}
