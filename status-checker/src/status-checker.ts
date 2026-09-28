import { setFailed } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import {
    MILLISECONDS_PER_MINUTE,
    MILLISECONDS_PER_SECOND,
    POLLING_INTERVAL_MILLISECONDS,
    wait,
} from "./wait";

export async function isSuccessStatus(token: string) {
    const octokit = getOctokit(token);
    const owner = context.repo.owner;
    const repo = context.repo.repo;
    const payload = context.payload;

    if (
        ["pull_request", "pull_request_target"].includes(context.eventName) &&
        payload?.action
    ) {
        const prNumber = payload.number;
        console.log({ prNumber });

        const commit = payload.pull_request?.head.sha;
        console.log({ commit });

        let buildStatus: any;

        const { data: statuses } =
            await octokit.rest.repos.listCommitStatusesForRef({
                owner,
                repo,
                ref: commit,
            });

        // Get the most recent OPS status.
        for (const status of statuses) {
            if (status.context === "OpenPublishing.Build") {
                buildStatus = status;
                console.log("Found OPS status check.");
                break;
            }
        }

        // Loop and wait if there's no OPS build status yet.
        // (This is unusual.)
        const loops = 30;
        const waitMinutes =
            (loops * POLLING_INTERVAL_MILLISECONDS) / MILLISECONDS_PER_MINUTE;
        const pollingIntervalSeconds =
            POLLING_INTERVAL_MILLISECONDS / MILLISECONDS_PER_SECOND;
        for (let i = 0; i < loops && !buildStatus; i++) {
            // Sleep until the next status check.
            await wait(POLLING_INTERVAL_MILLISECONDS);

            const { data: statuses } =
                await octokit.rest.repos.listCommitStatusesForRef({
                    owner,
                    repo,
                    ref: commit,
                });

            // Get the most recent OPS status.
            for (const status of statuses) {
                if (status.context === "OpenPublishing.Build") {
                    buildStatus = status;
                    console.log("Found OPS status check.");
                    break;
                }
            }
        }

        // Didn't find OPS status. This is bad.
        if (!buildStatus) {
            setFailed(
                `Did not find OPS status check after waiting for ${waitMinutes} minutes. If it shows 'Expected — Waiting for status to be reported', close and reopen the pull request to trigger a build.`
            );
        }

        // Check state of OPS status check.
        while (buildStatus.state === "pending") {
            console.log(
                `OPS status check is still pending; sleeping for ${pollingIntervalSeconds} seconds.`
            );

            // Sleep until the next status check.
            await wait(POLLING_INTERVAL_MILLISECONDS);

            // Get latest OPS status.
            const { data: statuses } =
                await octokit.rest.repos.listCommitStatusesForRef({
                    owner,
                    repo,
                    ref: commit,
                });

            buildStatus = null;
            for (const status of statuses) {
                if (status.context === "OpenPublishing.Build") {
                    buildStatus = status;
                    break;
                }
            }

            // This should never happen since if nothing else,
            // we'll find the OPS status we found initially.
            if (!buildStatus) {
                throw new Error("Did not find OPS status check.");
            }
        }

        // Status is no longer pending.
        console.log("OPS status check has completed.");

        if (buildStatus.state === "success") {
            if (buildStatus.description === "Validation status: warnings") {
                setFailed(
                    "Please fix OPS build warnings before merging. To see the warnings, click 'Details' next to the OpenPublishing.build status check at the bottom of your pull request."
                );
            } else {
                console.log(
                    "OpenPublishing.Build status check does not have warnings."
                );
                return true;
            }
        } else {
            // Build status is error/failure.
            setFailed(
                "OpenPublishing.Build status is either failure or error."
            );
        }
    } else {
        setFailed(
            "Event is not a pull request or payload action is undefined."
        );
    }

    return false;
}
