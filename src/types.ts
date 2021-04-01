import { Record } from "jsforce";
import { ConfigAggregator, Logger, Org, SfdxProject } from '@salesforce/core';
import { JsonMap } from '@salesforce/ts-types';
import { OutputArgs, OutputFlags } from '@oclif/parser';
import { SfdxResult, UX } from '@salesforce/command';

export interface ObjectConfig {
  query?: string;
  externalid?: string;
  directory?: string;
  filename?: string;
  cleanupFields?: string[];
  hasRecordTypes?: boolean;
  enableMultiThreading?: boolean;
}

export interface ObjectConfigEntry {
  sObjectType: string;
  objectConfig: ObjectConfig;
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
  allObjects?: string[];
  objects?: { [sObject: string]: ObjectConfig };
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
  readRecords(sObjectType: string): Promise<Record[]>;
  importRecords(sObjectType: string, records: Record[]): Promise<ImportResult>;
}

export interface Context {
  command: CommandContext;
  config: Config;
  service: ImportService;
  state: {
    [key: string]: unknown
  }
}

export type PreImportContext = Context;

export interface RecordContext extends Context, ObjectConfigEntry {
  records: Record[];
}

export type PreImportObjectContext = RecordContext;

export interface PostImportObjectContext extends RecordContext {
  importResult: ImportResult;
}

export interface PostImportContext extends Context {
  results: ImportResult[];
}

export interface ExportResult {
  sObjectType: string;
  records: Record[];
}

export type PreExportContext = Context;

export interface PreExportObjectContext extends Context, ObjectConfigEntry {}

export type PostExportObjectContext = RecordContext;

export interface PostExportContext extends Context {
  results: ExportResult[];
}
