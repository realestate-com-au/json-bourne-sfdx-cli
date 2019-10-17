[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

# JSON Bourne

This plugin allows you to migrate reference data between Salesforce environments. The plugin relies on External IDs being setup on each of the objects that you wish to migrate, but has a generator that can assist you in populating your External Ids.

JSON Bourne consists of two parts:

1. A Salesforce managed package that largely consists of an API to receive the data being imported.
2. A Salesforce CLI plugin that allows you to orchestrate the import and export of data (which can be run by a developer or installed into a CI pipeline).

# Salesforce Managed Package

There is a server side component to this package. This has been packaged into a Managed Package and the links can be found below:

## Package Links

| Version | Link                                                                                         |
| ------- | -------------------------------------------------------------------------------------------- |
| 1.2     | [Click Here](https://login.salesforce.com/packaging/installPackage.apexp?p0=04t2v0000007RE9) |
| 1.1     | [Click Here](https://login.salesforce.com/packaging/installPackage.apexp?p0=04t2v000000CdUM) |
| 1.0     | _deprecated_                                                                                 |

The package must be installed into all orgs that you can to _import_ data to, but the package is not required on an org to export.

> This package is also available open source, so you can choose to add this metadata into your Salesforce project as unmanaged meta. If you do this, ensure you set the flag `useManagedPackage` in all configuration files to `false`.

## Object setup

Each object that will be exported/imported by JSON Bourne must have the following setup:

1. An external Id
2. A trigger to populate the external id field when a record is created _(optional)_

> The use of the trigger is optional, but any record extracted and migrated via JSON Bourne _must_ have an External Id.

## Trigger Example

The managed package comes with the capability to generate an external id on any object. You first need to create a new class called `MigrationIdAllocation`

```java
public class MigrationIdAllocation{

    protected String EXTERNAL_ID_FIELD{
        get{
            if(String.valueOf(objectType) == 'Product2'){
                return 'Unique_Product_Code__c';
            }
            return 'Migration_Id__c';
        }
    }

    public MigrationIdAllocation() {
        if(Trigger.isBefore && (Trigger.isInsert || Trigger.isUpdate)){
            JSON.MigrationIdService.addMigrationId(records, EXTERNAL_ID_FIELD);
        }
    }

}
```

Next, this class can be invoked by any trigger to generate an external Id:

```java
trigger errorConditionTrigger on SBQQ__ErrorCondition__c (before insert,before update) {
	MigrationIdAllocation handler = new MigrationIdAllocation();
}
```

In this example, `MigrationIdAllocation` is configured to check the object name. If it is `Product2` then it specifies to populate the `Unique_Product_Code__c`, else it expects the field `Migration_Id__c` to exist. In the same manner, you can add fields called `Migration_Id__c` to most objects, but explicitly specify any objects that have an external id field with a different API name.

You only need to create the `MigrationIdAllocation` class once, but each object that requires an auto-generated external Id will need a trigger.

# Salesforce CLI Plugin

To install this plugin to Salesforce CLI, use the `plugins:install` command:

    sfdx plugins:install json-bourne-sfdx

## Configuration File

The plugin requires a configuration file. Here is an example:

```json
{
  "pollTimeout": 30,
  "pollBatchSize": 150,
  "maxPollCount": 60,
  "payloadLength": 2999800,
  "importRetries": 3,
  "useManagedPackage": true,
  "allObjects": ["ObjectOne__c", "ObjectTwo__c"],
  "objects": {
    "ObjectOne__c": {
      "query": "SELECT Name, FieldOne__c, FieldTwo__c, Migration_Id__c FROM ObjectOne__c",
      "externalid": "Migration_ID__c",
      "directory": "objectOne",
      "cleanupFields": [],
      "hasRecordTypes": false
    },
    "ObjectTwo__c": {
      "query": "SELECT Name, ObjectOne__r.Migration_Id__c, Migration_Id__c, FieldOne__c, RecordType.DeveloperName FROM ObjectTwo__c",
      "externalid": "Migration_Id__c",
      "directory": "objectTwo",
      "cleanupFields": ["ObjectOne__r"],
      "hasRecordTypes": true,
      "enableMultiThreading": true
    }
  }
}
```

| Parameter                      | Definition                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pollTimeout`                  | How long the query will wait on a response                                                                                                                                                                                                                                                                                             |
| `pollBatchSize`                | The batch size the data is polled in                                                                                                                                                                                                                                                                                                   |
| `maxPollCount`                 | The maximum number of queries performed on one object in one transaction                                                                                                                                                                                                                                                               |
| `payloadLength`                | The character size data will be broken into for `imports`                                                                                                                                                                                                                                                                              |
| `importRetries`                | How many times the import method will attempt to retry failed imports before exiting                                                                                                                                                                                                                                                   |
| `useManagedPackage`            | If the server side components are in a managed package, this should be set to true                                                                                                                                                                                                                                                     |
| `allObjects`                   | An array with all of the objects (the order they are specified is the order they are processed)                                                                                                                                                                                                                                        |
| `objects`                      | An array of configuration for each object (there should be one entry per entry in the `allObjects` array)                                                                                                                                                                                                                              |
| `objects:query`                | The query that is performed to `export` the data from Salesforce                                                                                                                                                                                                                                                                       |
| `objects:externalId`           | The external id field for this object (API Name). This will also be used as the file name for the extracted json files.                                                                                                                                                                                                                |
| `objects:directory`            | The name of the directory the extracted data will be stored in. It is a relevant path from where the export command is executed of `data/directory`                                                                                                                                                                                    |  |
| `objects:cleanupFields`        | Any fields fetched from a parent lookup that may be blank should be specified here. For example, if you are retrieving the Migration Id of a parent (`ObjectOne__r.Migration_Id__c`) and this lookup _could_ be blank, then `ObjectOne__r` should be added to this array as the plugin cannot handle null values on parent references. |
| `objects:hasRecordTypes`       | Whether dynamic record type Ids need to be handled or not (if true, ensure the `RecordType.DeveloperName` is in the query)                                                                                                                                                                                                             |
| `objects:enableMultiThreading` | The payloads can be imported into this object in parallel (instead of one after the other).                                                                                                                                                                                                                                            |

The configuration file can be stored within a Salesforce DX project, for example within the `config/` directory alongside the project configuration file. This file is referenced during each `import` or `export` request with the `-c` parameter (see below for more details). As this file is referenced each time, you can create a different configuration file for each logical grouping of reference data, for example if you have both Salesforce CPQ and Adobe Sign installed which both have reference data, you could create one configuration file for Salesforce CPQ and one configuration file for Adobe Sign.

> All data that is exported using JSON Bourne will be saved into a `data/` directory (and into subdirectories that are the names specified on each object configuration specified within the configuration file). Ensure the `data/` directory exists in your Salesforce DX project before exporting any reference data.

### Configuration Files Templates

These configuration files relate to common Salesforce packages. Crafting the configuration file can be the most difficult part of setting up JSON Bourne, so this list is a way to kick start your implementation. If you have any configuration files crafted please add them to this list!

- [Salesforce CPQ Configuration File](https://gist.github.com/ddawson235/c6e639691d0876c3b0b591faf66a4565) (David Dawson [@ddawson235](https://github.com/ddawson235))

# Plugin commands

<!-- toc -->

<!-- tocstop -->
<!-- install -->
<!-- usage -->

```sh-session
$ npm install -g json-bourne-sfdx
$ json-bourne-sfdx COMMAND
running command...
$ json-bourne-sfdx (-v|--version|version)
json-bourne-sfdx/0.1.0 darwin-x64 node-v8.11.2
$ json-bourne-sfdx --help [COMMAND]
USAGE
  $ json-bourne-sfdx COMMAND
...
```

<!-- usagestop -->
<!-- commands -->

- [`json-bourne-sfdx bourne:export [-o <string>] [-c <string>] [-a] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#json-bourne-sfdx-bourneexport--o-string--c-string--a--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
- [`json-bourne-sfdx bourne:import [-o <string>] [-c <string>] [-a] [-d <string>] [-r] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#json-bourne-sfdx-bourneimport--o-string--c-string--a--d-string--r--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)

## `json-bourne-sfdx bourne:export [-o <string>] [-c <string>] [-a] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Exports records from the object specified.

```
USAGE
  $ json-bourne-sfdx bourne:export [-o <string>] [-c <string>] [-a] [-u <string>] [--apiversion <string>] [--json]
  [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -a, --processall                                                                  Exports records from all objects
                                                                                    specified in the config file.

  -c, --configfile=configfile                                                       [REQUIRED] The configuration JSON
                                                                                    file location.

  -o, --object=object                                                               The sobject that you wish to
                                                                                    import/export reference data from.

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

EXAMPLE
  $ sfdx bourne:export -o Product2 -u myOrg -c config/cpq-cli-def.json
       Requesting data, please wait.... Request completed! Received X records.
```

_See code: [src/commands/bourne/export.ts](https://github.com/Workspace/json-bourne-sfdx/blob/v0.1.0/src/commands/bourne/export.ts)_

## `json-bourne-sfdx bourne:import [-o <string>] [-c <string>] [-a] [-d <string>] [-r] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Imports records from the object specified.

```
USAGE
  $ json-bourne-sfdx bourne:import [-o <string>] [-c <string>] [-a] [-d <string>] [-r] [-u <string>] [--apiversion
  <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -a, --processall                                                                  Imports records from all objects
                                                                                    specified in the config file.

  -c, --configfile=configfile                                                       [REQUIRED] The configuration JSON
                                                                                    file location.

  -d, --datadir=datadir                                                             The path where the reference data
                                                                                    resides. The default is 'data'.

  -o, --object=object                                                               The sobject that you wish to
                                                                                    import/export reference data from.

  -r, --remove                                                                      Delete the record(s) from the target
                                                                                    within the specified directory.

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

EXAMPLE
  $ sfdx bourne:import -o Product2 -u myOrg -c config/cpq-cli-def.json
       Deploying data, please wait.... Deployment completed!
```

_See code: [src/commands/bourne/import.ts](https://github.com/Workspace/json-bourne-sfdx/blob/v0.1.0/src/commands/bourne/import.ts)_

<!-- commandsstop -->

License

---

Copyright (C) 2012 REA Group Ltd.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
