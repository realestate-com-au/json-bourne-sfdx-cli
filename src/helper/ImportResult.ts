import { ApexResponse } from "./ApexResponse";
import { Helper } from "./Helper";

export class ImportResult {
  public results: Array<ApexResponse>;
  public requests: number;
  public responses: any[];
  public total: number;
  public success: number;
  public failure: number;
  public failureResults: Array<ApexResponse>;

  constructor(responses: any[]) {
    this.responses = responses;
    this.requests = responses.length;
    this.results = this.getResult();
    this.total = this.results.length;
    this.failureResults = this.getFailureResults();
    this.failure = this.failureResults.length;
    this.success = this.total - this.failure;
  }

  private getFailureResults() {
    return this.results.filter(result => {
      return result.result === "FAILED";
    });
  }

  private getResult() {
    let resolveResults = [];
    this.responses.forEach(res => {
      resolveResults = resolveResults.concat(JSON.parse(res));
    });
    return resolveResults;
  }

  public print() {
    if (this.failure > 0 && this.success > 0) {
      console.log("Error deploying data");
      console.log(Helper.colors.yellow("== DEPLOYED WITH ERRORS"));
    } else if (this.success > 0) {
      console.log(Helper.colors.green("== SUCCESS"));
    } else if (this.failure > 0) {
      console.log(Helper.colors.red("== ERROR"));
    } else {
      console.log(Helper.colors.magenta("== NO RECORDS TO PUSH"));
    }

    console.log("Successful deployments: ", this.success);
    console.log("Failed deployments: ", this.failure);
    console.log(Helper.cTable.getTable(this.failureResults));
  }
}
