import { slackApp } from "../../../index";
import TakesConfig from "../../../libs/config";
import { db } from "../../../libs/db";
import { takes as takesTable } from "../../../libs/schema";
import { eq } from "drizzle-orm";

// Check for paused sessions that have exceeded the max pause duration
export async function expirePausedSessions() {
	const now = new Date();
	const pausedTakes = await db
		.select()
		.from(takesTable)
		.where(eq(takesTable.status, "paused"));

	for (const take of pausedTakes) {
		if (take.pausedAt) {
			const pausedDuration =
				(now.getTime() - take.pausedAt.getTime()) / (60 * 1000); // Convert to minutes

			// Send warning notification when getting close to expiration
			if (
				pausedDuration >
					TakesConfig.MAX_PAUSE_DURATION -
						TakesConfig.NOTIFICATIONS.PAUSE_EXPIRATION_WARNING &&
				!take.notifiedPauseExpiration
			) {
				// Update notification flag
				await db
					.update(takesTable)
					.set({
						notifiedPauseExpiration: true,
					})
					.where(eq(takesTable.id, take.id));

				// Send warning message
				try {
					const timeRemaining = Math.round(
						TakesConfig.MAX_PAUSE_DURATION - pausedDuration,
					);
					await slackApp.client.chat.postMessage({
						channel: take.userId,
						text: `⚠️ Reminder: Your paused takes session will automatically complete in about ${timeRemaining} minutes if not resumed.`,
					});
				} catch (error) {
					console.error(
						"Failed to send pause expiration warning:",
						error,
					);
				}
			}

			// Auto-expire paused sessions that exceed the max pause duration
			if (pausedDuration > TakesConfig.MAX_PAUSE_DURATION) {
				let ts: string | undefined;
				// Notify user that their session was auto-completed
				try {
					const res = await slackApp.client.chat.postMessage({
						channel: take.userId,
						text: `⏰ Your paused takes session has been automatically completed because it was paused for more than ${TakesConfig.MAX_PAUSE_DURATION} minutes.\n\nPlease upload your takes video in this thread within the next 24 hours!`,
					});
					ts = res.ts;
				} catch (error) {
					console.error(
						"Failed to notify user of auto-completed session:",
						error,
					);
				}

				await db
					.update(takesTable)
					.set({
						status: "waitingUpload",
						completedAt: now,
						ts,
						notes: take.notes
							? `${take.notes} (Automatically completed due to pause timeout)`
							: "Automatically completed due to pause timeout",
					})
					.where(eq(takesTable.id, take.id));
			}
		}
	}
}

// Check for active sessions that are almost done
export async function checkActiveSessions() {
	const now = new Date();
	const activeTakes = await db
		.select()
		.from(takesTable)
		.where(eq(takesTable.status, "active"));

	for (const take of activeTakes) {
		const endTime = new Date(
			take.startedAt.getTime() +
				take.durationMinutes * 60000 +
				(take.pausedTimeMs || 0),
		);

		const remainingMs = endTime.getTime() - now.getTime();
		const remainingMinutes = remainingMs / 60000;

		if (
			remainingMinutes <= TakesConfig.NOTIFICATIONS.LOW_TIME_WARNING &&
			remainingMinutes > 0 &&
			!take.notifiedLowTime
		) {
			await db
				.update(takesTable)
				.set({ notifiedLowTime: true })
				.where(eq(takesTable.id, take.id));

			console.log("Sending low time warning to user");

			try {
				await slackApp.client.chat.postMessage({
					channel: take.userId,
					text: `⏱️ Your takes session has less than ${TakesConfig.NOTIFICATIONS.LOW_TIME_WARNING} minutes remaining.`,
				});
			} catch (error) {
				console.error("Failed to send low time warning:", error);
			}
		}

		if (remainingMs <= 0) {
			let ts: string | undefined;
			try {
				const res = await slackApp.client.chat.postMessage({
					channel: take.userId,
					text: "⏰ Your takes session has automatically completed because the time is up. Please upload your takes video in this thread within the next 24 hours!",
				});

				ts = res.ts;
			} catch (error) {
				console.error(
					"Failed to notify user of completed session:",
					error,
				);
			}

			await db
				.update(takesTable)
				.set({
					status: "waitingUpload",
					completedAt: now,
					ts,
					notes: take.notes
						? `${take.notes} (Automatically completed - time expired)`
						: "Automatically completed - time expired",
				})
				.where(eq(takesTable.id, take.id));
		}
	}
}
