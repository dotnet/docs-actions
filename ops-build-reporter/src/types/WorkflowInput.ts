import { getInput } from "@actions/core";
import { join } from "path";

function integerInput(
    name: string,
    fallback: number,
    min: number,
    max: number,
): number {
    const raw = getInput(name);
    const value = raw === "" ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`${name} must be an integer from ${min} to ${max}.`);
    }
    return value;
}

export class WorkflowInput {
    get collapsibleAfter(): number {
        return integerInput("collapsible_after", 12, 0, 1000);
    }

    get repoToken(): string {
        const val = getInput("repo_token", { required: true });
        return val;
    }

    get maxRowCount(): number {
        return integerInput("max_row_count", 50, 1, 1000);
    }

    get maxWaitTimeMinutes(): number {
        return integerInput("max_wait_time_minutes", 20, 1, 60);
    }

    get outputDirectory(): string {
        const directory = getInput("output_directory");
        if (directory) {
            return directory;
        }
        if (!process.env.RUNNER_TEMP) {
            throw new Error("output_directory or RUNNER_TEMP is required.");
        }
        return join(process.env.RUNNER_TEMP, "ops-build-report");
    }

    constructor() {}
}

export const workflowInput: WorkflowInput = new WorkflowInput();
