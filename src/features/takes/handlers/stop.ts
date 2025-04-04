import { slackClient } from "../../../index";
import { db } from "../../../libs/db";
import { takes as takesTable } from "../../../libs/schema";
import { eq } from "drizzle-orm";
import { getActiveTake, getPausedTake } from "../services/database";
import type { MessageResponse } from "../types";
import { prettyPrintTime } from "../../../libs/time";
import { calculateElapsedTime } from "../../../libs/time-periods";

export default async function handleStop(
	userId: string,
	args?: string[],
): Promise<MessageResponse | undefined> {
	const activeTake = await getActiveTake(userId);

	if (activeTake.length === 0) {
		const pausedTake = await getPausedTake(userId);

		if (pausedTake.length === 0) {
			return {
				text: `You don't have an active or paused takes session!`,
				response_type: "ephemeral",
			};
		}

		// Mark the paused session as completed
		const pausedTakeToStop = pausedTake[0];
		if (!pausedTakeToStop) {
			return;
		}

		// Extract notes if provided
		let notes = undefined;
		if (args && args.length > 1) {
			notes = args.slice(1).join(" ");
		}

		const elapsed = calculateElapsedTime(
			JSON.parse(pausedTakeToStop.periods),
		);

		const res = await slackClient.chat.postMessage({
			channel: userId,
			text: "🎬 Your paused takes session has been completed. Please upload your takes video in this thread within the next 24 hours!",
			blocks: [
				{
					type: "section",
					text: {
						type: "mrkdwn",
						text: "🎬 Your paused takes session has been completed. Please upload your takes video in this thread within the next 24 hours!",
					},
				},
				{
					type: "divider",
				},
				{
					type: "context",
					elements: [
						{
							type: "mrkdwn",
							text: `*Elapsed Time:* \`${prettyPrintTime(elapsed)}\`${pausedTakeToStop.description ? ` working on: *${pausedTakeToStop.description}*` : ""}`,
						},
					],
				},
			],
		});

		await db
			.update(takesTable)
			.set({
				status: "waitingUpload",
				ts: res.ts,
				completedAt: new Date(),
				elapsedTimeMs: elapsed,
				...(notes && { notes }),
			})
			.where(eq(takesTable.id, pausedTakeToStop.id));
	} else {
		// Mark the active session as completed
		const activeTakeToStop = activeTake[0];
		if (!activeTakeToStop) {
			return;
		}

		// Extract notes if provided
		let notes = undefined;
		if (args && args.length > 1) {
			notes = args.slice(1).join(" ");
		}

		const elapsed = calculateElapsedTime(
			JSON.parse(activeTakeToStop.periods),
		);

		const res = await slackClient.chat.postMessage({
			channel: userId,
			text: "🎬 Your takes session has been completed. Please upload your takes video in this thread within the next 24 hours!",
			blocks: [
				{
					type: "section",
					text: {
						type: "mrkdwn",
						text: "🎬 Your takes session has been completed. Please upload your takes video in this thread within the next 24 hours!",
					},
				},
				{
					type: "divider",
				},
				{
					type: "context",
					elements: [
						{
							type: "mrkdwn",
							text: `\`${prettyPrintTime(elapsed)}\`${activeTakeToStop.description ? ` working on: *${activeTakeToStop.description}*` : ""}`,
						},
					],
				},
			],
		});

		await db
			.update(takesTable)
			.set({
				status: "waitingUpload",
				ts: res.ts,
				completedAt: new Date(),
				elapsedTimeMs: elapsed,
				...(notes && { notes }),
			})
			.where(eq(takesTable.id, activeTakeToStop.id));
	}

	return {
		text: "✅ Takes session completed! I hope you had fun!",
		response_type: "ephemeral",
		blocks: [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: "✅ Takes session completed! I hope you had fun!",
				},
			},
			{
				type: "actions",
				elements: [
					{
						type: "button",
						text: {
							type: "plain_text",
							text: "🎬 Start New Session",
							emoji: true,
						},
						value: "start",
						action_id: "takes_start",
					},
					{
						type: "button",
						text: {
							type: "plain_text",
							text: "📋 History",
							emoji: true,
						},
						value: "history",
						action_id: "takes_history",
					},
				],
			},
		],
	};
}
