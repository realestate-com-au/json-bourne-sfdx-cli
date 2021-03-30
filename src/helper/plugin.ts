/* eslint-disable @typescript-eslint/no-var-requires */
import { sync as resolveSync } from "resolve";
import * as pathUtils from "path";
import { DataImportPlugin } from "../types";

export interface PluginLoadOptions {
  tsResolveBaseDir?: string;
}

export const loadPluginModule = (path: string, opts?: PluginLoadOptions): any => {
  if (path.endsWith(".ts")) {
    const tsNodeModule = resolveSync("ts-node", {
      basedir: opts?.tsResolveBaseDir || pathUtils.dirname(path),
      preserveSymLinks: true,
    });
    if (tsNodeModule) {
      const tsNode = require(tsNodeModule);
      tsNode.register({
        transpileOnly: true,
        skipProject: true,
        compilerOptions: {
          target: "es2017",
          module: "commonjs",
          strict: false,
          skipLibCheck: true,
          skipDefaultLibCheck: true,
          moduleResolution: "node",
          allowJs: true,
          esModuleInterop: true,
        },
        files: [path],
      });
    } else {
      throw new Error(`In order to use TypeScript, you need to install "ts-node" module:
        npm install -D ts-node
      or
        yarn add -D ts-node
      `);
    }
  }

  return require(path);
};

export const loadPlugin = <T>(path: string, opts?: PluginLoadOptions): T => {
  const module = loadPluginModule(path, opts);
  // NOTE: currently require the plugin implementation to be the default export
  return new module();
};
