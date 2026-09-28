import {
    INITIAL_WAIT_MILLISECONDS,
    MILLISECONDS_PER_MINUTE,
    wait,
} from "./wait";
import { isSuccessStatus } from "./status-checker";
import { setFailed } from "@actions/core";
import { workflowInput } from "./types/WorkflowInput";

async function run(): Promise<void> {
    try {
        const token: string = workflowInput.repoToken;

        // Wait 5 minutes before checking status check result.
        await wait(INITIAL_WAIT_MILLISECONDS);
        console.log(
            `Waited ${
                INITIAL_WAIT_MILLISECONDS / MILLISECONDS_PER_MINUTE
            } minutes.`
        );

        // Wait for success/fail status of the build.
        const isSuccess = await isSuccessStatus(token);
        if (isSuccess) {
            console.log("✅ Build status is good...");
        } else {
            console.log("❌ Build status has warnings or errors!");
        }
    } catch (error: unknown) {
        const e = error as Error;
        setFailed(e.message);
    }
}

run();
