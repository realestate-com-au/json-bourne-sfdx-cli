/* eslint-disable @typescript-eslint/no-var-requires */
import { sync as resolveSync } from "resolve";
import * as pathUtils from "path";

export interface PluginLoadOptions {
  tsResolveBaseDir?: string;
}

export const loadScriptModule = (path: string, opts?: PluginLoadOptions): any => {
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

export const runScript = async <C = void, R = void>(path: string, context: C, opts?: PluginLoadOptions): Promise<R> => {
  const scriptModule = loadScriptModule(path, opts);
  let result;
  if (typeof scriptModule === 'function') {
    result = await Promise.resolve(scriptModule(context));
  } else if (scriptModule.run) {
    result = await Promise.resolve(scriptModule.run(context));
  }
  return result;
};
