import { describe, expect, it } from "vitest";
import { CANONICAL, identity } from "./identity";

describe("identity", () => {
  it("is the original owner's values when nothing is set", () => {
    expect(identity({})).toEqual({
      ghUser: "acorrea-designli",
      gitName: "acorrea-designli",
      gitEmail: "andres.correa@designli.co",
      slackUserId: "U06E2UBDC73",
      sessionsDir: "G:/WorkSpace/designli",
      worktreesRoot: "G:/WorkSpace/designli-wt",
      settingsLocal: "G:/WorkSpace/designli/.claude/settings.local.json",
    });
    expect(identity({})).toEqual(CANONICAL);
  });

  it("treats blank variables as unset", () => {
    expect(identity({ MESA_GH_USER: "  ", MESA_GIT_EMAIL: "", MESA_SESSIONS_DIR: " ", MESA_WORKTREES_ROOT: "" })).toEqual(CANONICAL);
  });

  it("reads each override", () => {
    const i = identity({
      MESA_GH_USER: "ana-dev",
      MESA_GIT_NAME: "Ana Dev",
      MESA_GIT_EMAIL: "ana@example.com",
      MESA_SLACK_USER_ID: "U0ANA",
      MESA_SESSIONS_DIR: "D:\\work\\ana\\",
      MESA_WORKTREES_ROOT: "E:/wt",
      MESA_SETTINGS_LOCAL: "E:/s.json",
    });
    expect(i).toEqual({ ghUser: "ana-dev", gitName: "Ana Dev", gitEmail: "ana@example.com", slackUserId: "U0ANA", sessionsDir: "D:/work/ana", worktreesRoot: "E:/wt", settingsLocal: "E:/s.json" });
  });

  it("derives the worktrees root and the settings file from the sessions folder", () => {
    const i = identity({ MESA_SESSIONS_DIR: "D:/work/ana" });
    expect(i.worktreesRoot).toBe("D:/work/ana-wt");
    expect(i.settingsLocal).toBe("D:/work/ana/.claude/settings.local.json");
    expect(i.ghUser).toBe("acorrea-designli");
  });
});
