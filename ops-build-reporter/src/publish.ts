import { getInput, setFailed } from "@actions/core";
import { publishBuildReport } from "./publisher";

async function run(): Promise<void> {
    try {
        await publishBuildReport(getInput("repo_token", { required: true }));
    } catch (error: unknown) {
        setFailed(error instanceof Error ? error.message : String(error));
    }
}

run();
