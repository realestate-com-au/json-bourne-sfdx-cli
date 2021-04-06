import { Record } from "jsforce";
import { ConfigAggregator, Logger, Org, SfdxProject } from "@salesforce/core";
import { JsonMap } from "@salesforce/ts-types";
import { OutputArgs, OutputFlags } from "@oclif/parser";
import { SfdxResult, UX } from "@salesforce/command";

export interface ObjectConfig {
  sObjectType?: string;
  query?: string;
  externalid?: string;
  directory?: string;
  filename?: string;
  cleanupFields?: string[];
  hasRecordTypes?: boolean;
  enableMultiThreading?: boolean;
}

export interface ScriptConfig {
  preimport?: string;
  preimportobject?: string;
  postimportobject?: string;
  postimport?: string;
  preexport?: string;
  preexportobject?: string;
  postexportobject?: string;
  postexport?: string;
  tsResolveBaseDir?: string;
}

export interface Config {
  script?: ScriptConfig;
  pollTimeout?: number;
  pollBatchSize?: number;
  maxPollCount?: number;
  payloadLength?: number;
  importRetries?: number;
  useManagedPackage?: boolean;
  allObjects?: string[]; // NOTE: to support legacy config
  objects?: { [sObjectType: string]: ObjectConfig } | ObjectConfig[]; // NOTE: map setup to support legacy config
  allowPartial?: boolean;
}

export interface ImportRequest {
  sObjectType: string;
  operation: string;
  payload: Record[];
  extIdField: string;
}

export interface RecordImportResult {
  recordId?: string;
  externalId?: string;
  message?: string;
  result?: "SUCCESS" | "FAILED";
}

export interface ImportResult {
  sObjectType: string;
  records?: Record[];
  results?: RecordImportResult[];
  total?: number;
  failure?: number;
  success?: number;
  failureResults?: RecordImportResult[];
  [key: string]: unknown;
}

export interface CommandContext {
  logger: Logger;
  ux: UX;
  configAggregator: ConfigAggregator;
  org?: Org;
  hubOrg?: Org;
  project?: SfdxProject;
  flags: OutputFlags<any>;
  args: OutputArgs<any>;
  varargs?: JsonMap;
  result: SfdxResult;
}

export interface ImportService {
  readRecords(objectConfig: ObjectConfig): Promise<Record[]>;
  importRecords(
    objectConfig: ObjectConfig,
    records: Record[]
  ): Promise<ImportResult>;
}

export interface Context {
  command: CommandContext;
  config: Config;
  objectConfigs: ObjectConfig[];
  state: {
    [key: string]: unknown;
  };
}

export interface ImportContext extends Context {
  service: ImportService;
}

export type PreImportContext = ImportContext;

export interface ObjectContext extends Context {
  objectConfig: ObjectConfig;
}

export interface RecordContext extends ObjectContext {
  records: Record[];
}

export interface ImportRecordContext extends RecordContext, ImportContext {}

export type PreImportObjectContext = ImportRecordContext;

export interface PostImportObjectContext extends ImportRecordContext {
  importResult: ImportResult;
}

export interface PostImportContext extends ImportContext {
  results: ImportResult[];
}

export interface ExportResult {
  sObjectType: string;
  total: number;
  path: string;
  records: Record[];
}

export type PreExportContext = Context;

export interface PreExportObjectContext extends Context, ObjectContext {}

export type PostExportObjectContext = RecordContext;

export interface PostExportContext extends Context {
  results: ExportResult[];
}
