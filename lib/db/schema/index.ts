import * as camSchemas from "./cam";
import * as authSchemas from "./auth";
import * as coreSchemas from "./core";
import * as entitiesSchemas from "./entities";
import * as relationsSchemas from "./relations";

export default {
  ...camSchemas,
  ...authSchemas,
  ...coreSchemas,
  ...entitiesSchemas,
  ...relationsSchemas
}
