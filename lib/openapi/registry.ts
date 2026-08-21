import { extendZodWithOpenApi, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import zod from "zod";

extendZodWithOpenApi(zod);

export const registry = new OpenAPIRegistry();
