import { setFailed } from "@actions/core";
import { createBuildReport } from "./pull-updater";
import { workflowInput } from "./types/WorkflowInput";

async function run(): Promise<void> {
    try {
        const token: string = workflowInput.repoToken;
        await createBuildReport(token);
    } catch (error: unknown) {
        setFailed(error instanceof Error ? error.message : String(error));
    }
}

run();
