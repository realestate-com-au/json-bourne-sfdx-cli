/* eslint-disable @typescript-eslint/no-var-requires */
import { sync as resolveSync } from 'resolve';
import * as pathUtils from 'path';

export interface ScriptOptions {
    path: string;
    context: unknown;
    tsNodeResolveBaseDir?: string;
}

export const runScript = async (opts: ScriptOptions): Promise<unknown> => {
    const { path, context, tsNodeResolveBaseDir } = opts;
    if (path.endsWith('.ts')) {
        const tsNodeModule = resolveSync('ts-node', {
          basedir: tsNodeResolveBaseDir || pathUtils.dirname(path),
          preserveSymLinks: true,
        });
        if (tsNodeModule) {
          const tsNode = require(tsNodeModule);
          tsNode.register({
            transpileOnly: true,
            skipProject: true,
            compilerOptions: {
              target: 'es2017',
              module: 'commonjs',
              strict: false,
              skipLibCheck: true,
              skipDefaultLibCheck: true,
              moduleResolution: 'node',
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
  
    const scriptModule = require(path);
    let result;
    if (typeof scriptModule === 'function') {
        result = await Promise.resolve(scriptModule(context));
    } else if (scriptModule.run) {
        result = await Promise.resolve(scriptModule.run(context));
    }
    return result;
};