/**
 * Sends a fake (correctly signed) Instagram comment webhook to your local server so you can
 * test rules without Meta. Nothing is sent to Instagram unless a real token is configured.
 *
 *   INSTAGRAM_APP_SECRET=xxx npx tsx scripts/simulate-comment.ts "guide please" [igUserId] [mediaId]
 */
import { createHmac } from "node:crypto";

const secret = process.env.INSTAGRAM_APP_SECRET;
if (!secret) {
  console.error("Set INSTAGRAM_APP_SECRET so the request can be signed.");
  process.exit(1);
}

const [text = "guide", igUserId = process.env.INSTAGRAM_USER_ID ?? "1789", mediaId = "17900000000000001"] = process.argv.slice(2);
const target = process.env.WEBHOOK_URL ?? "http://localhost:3000/api/instagram/webhook";

const body = JSON.stringify({
  object: "instagram",
  entry: [
    {
      id: igUserId,
      time: Math.floor(Date.now() / 1000),
      changes: [
        {
          field: "comments",
          value: {
            id: `sim-${Date.now()}`,
            text,
            from: { id: "999000111", username: "test_commenter" },
            media: { id: mediaId, media_product_type: "REELS" },
          },
        },
      ],
    },
  ],
});

const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

async function main() {
  const res = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": signature },
    body,
  });
  console.log(res.status, await res.text());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
