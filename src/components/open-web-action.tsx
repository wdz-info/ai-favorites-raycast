import { Action, environment, getPreferenceValues, Icon, open } from "@raycast/api";
import { join } from "node:path";
import { openWebManagement } from "../open-web";
import { perform, Preferences } from "../runtime";

export function OpenWebAction({ favoriteId, storageDirectory }: { favoriteId?: string; storageDirectory?: string }) {
  return (
    <Action
      title={favoriteId ? "在网页中阅读这条收藏" : "打开网页收藏夹"}
      icon={Icon.Globe}
      shortcut={favoriteId ? undefined : { modifiers: ["cmd", "shift"], key: "o" }}
      onAction={() =>
        perform(async () => {
          const preferences = getPreferenceValues<Preferences>();
          await openWebManagement(
            { ...preferences, ...(storageDirectory ? { storageDirectory } : {}) },
            join(environment.assetsPath, "web", "server.cjs"),
            open,
            favoriteId,
          );
        })
      }
    />
  );
}
