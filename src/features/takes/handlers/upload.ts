import { eq } from "drizzle-orm";
import { slackApp, slackClient } from "../../../index";
import { db } from "../../../libs/db";
import { takes as takesTable, users as usersTable } from "../../../libs/schema";
import * as Sentry from "@sentry/bun";

export default async function upload() {
	slackApp.anyMessage(async ({ payload, context }) => {
		try {
			const user = payload.user as string;

			if (
				payload.subtype === "bot_message" ||
				payload.subtype === "thread_broadcast" ||
				payload.thread_ts ||
				payload.channel !== process.env.SLACK_LISTEN_CHANNEL
			)
				return;

			const userInDB = await db
				.select()
				.from(usersTable)
				.where(eq(usersTable.id, user));

			if (userInDB.length === 0) {
				await slackClient.chat.postMessage({
					channel: payload.channel,
					thread_ts: payload.ts,
					text: "We don't have a project for you; set one up by clicking the button below or by running `/takes`",
					blocks: [
						{
							type: "section",
							text: {
								type: "mrkdwn",
								text: "We don't have a project for you; set one up by clicking the button below or by running `/takes`",
							},
						},
						{
							type: "actions",
							elements: [
								{
									type: "button",
									text: {
										type: "plain_text",
										text: "setup your project",
									},
									action_id: "takes_setup",
								},
							],
						},
						{
							type: "context",
							elements: [
								{
									type: "plain_text",
									text: "don't forget to resend your update after setting up your project!",
								},
							],
						},
					],
				});
				return;
			}

			// Convert Slack formatting to markdown
			const replaceUserMentions = async (text: string) => {
				const regex = /<@([A-Z0-9]+)>/g;
				const matches = text.match(regex);

				if (!matches) return text;

				let result = text;
				for (const match of matches) {
					const userId = match.match(/[A-Z0-9]+/)?.[0];
					if (!userId) continue;

					try {
						const userInfo = await slackClient.users.info({
							user: userId,
						});
						const name =
							userInfo.user?.profile?.display_name ||
							userInfo.user?.real_name ||
							userId;
						result = result.replace(match, `@${name}`);
					} catch (e) {
						result = result.replace(match, `@${userId}`);
					}
				}
				return result;
			};

			const markdownText = (await replaceUserMentions(payload.text))
				.replace(/\*(.*?)\*/g, "**$1**") // Bold
				.replace(/_(.*?)_/g, "*$1*") // Italic
				.replace(/~(.*?)~/g, "~~$1~~") // Strikethrough
				.replace(/<(https?:\/\/[^|]+)\|([^>]+)>/g, "[$2]($1)"); // Links

			const mediaUrls = [];

			if (payload.files && payload.files.length > 0) {
				for (const file of payload.files) {
					if (
						file.mimetype &&
						(file.mimetype.startsWith("image/") ||
							file.mimetype.startsWith("video/"))
					) {
						const fileres = await slackClient.files.sharedPublicURL(
							{
								file: file.id as string,
								token: process.env.SLACK_USER_TOKEN,
							},
						);

						const fetchRes = await fetch(
							fileres.file?.permalink_public as string,
						);
						const html = await fetchRes.text();
						const match = html.match(
							/https:\/\/files.slack.com\/files-pri\/[^"]+pub_secret=([^"&]*)/,
						);
						const filePublicUrl = match?.[0];

						if (filePublicUrl) {
							mediaUrls.push(filePublicUrl);
						}
					}
				}
			}

			// fetch time spent on project via hackatime
			const timeSpentMs = 60000;

			await db.insert(takesTable).values({
				id: Bun.randomUUIDv7(),
				userId: user,
				ts: payload.ts,
				notes: markdownText,
				media: JSON.stringify(mediaUrls),
				elapsedTime: timeSpentMs / 1000,
			});

			await slackClient.reactions.add({
				channel: payload.channel,
				timestamp: payload.ts,
				name: "fire",
			});

			await slackClient.chat.postMessage({
				channel: payload.channel,
				thread_ts: payload.ts,
				text: ":inbox_tray: saved! thanks for the upload",
				blocks: [
					{
						type: "section",
						text: {
							type: "mrkdwn",
							text: `:inbox_tray: ${mediaUrls.length > 0 ? "uploaded media and " : ""}saved your notes!`,
						},
					},
				],
			});
		} catch (error) {
			console.error("Error handling file message:", error);
			await slackClient.chat.postMessage({
				channel: payload.channel,
				thread_ts: payload.ts,
				text: ":warning: there was an error processing your upload",
			});

			Sentry.captureException(error, {
				extra: {
					channel: payload.channel,
					user: payload.user,
					thread_ts: payload.ts,
				},
				tags: {
					type: "file_upload_error",
				},
			});
		}
	});
}
