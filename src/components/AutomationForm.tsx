import { saveAutomation } from "@/app/actions";
import type { Automation, IgAccount } from "@/lib/types";

interface Props {
  automation?: Automation;
  accounts: IgAccount[];
  envIgUserId?: string;
}

export function AutomationForm({ automation, accounts, envIgUserId }: Props) {
  const accountOptions = accounts.length
    ? accounts
    : envIgUserId
      ? [{ igUserId: envIgUserId, username: "env token account", accessToken: "", tokenExpiresAt: null }]
      : [];

  return (
    <form action={saveAutomation} className="stack">
      {automation?.id && <input type="hidden" name="id" value={automation.id} />}

      <div className="row">
        <label>
          Name
          <input type="text" name="name" defaultValue={automation?.name ?? ""} placeholder="Healthy Home Guide – Reel 14 Sept" required />
          <span className="help">Only you see this.</span>
        </label>
        <label>
          What they get
          <input type="text" name="offerName" defaultValue={automation?.offerName ?? ""} placeholder="Healthy Home Guide" />
          <span className="help">
            Used by <code>{"{{offer}}"}</code> in every message, as in “Thanks for asking for the {"{{offer}}"}”.
          </span>
        </label>
      </div>

      <div className="row">
        <label>
          Instagram account
          <select name="igUserId" defaultValue={automation?.igUserId ?? accountOptions[0]?.igUserId ?? ""} required>
            {accountOptions.map((a) => (
              <option key={a.igUserId} value={a.igUserId}>
                @{a.username} ({a.igUserId})
              </option>
            ))}
          </select>
          {accountOptions.length === 0 && <span className="help">Connect an account first (button on the home page).</span>}
        </label>
        <label>
          Post / Reel ID
          <input type="text" name="mediaId" defaultValue={automation?.mediaId ?? ""} placeholder="Leave empty for every post" />
          <span className="help">Find it via the media picker on the home page.</span>
        </label>
      </div>

      <div className="row">
        <label>
          Trigger keywords
          <input type="text" name="keywords" defaultValue={automation?.keywords.join(", ") ?? ""} placeholder="guide, GUIDE, 🔥" />
          <span className="help">Comma-separated. Leave empty to trigger on every comment.</span>
        </label>
        <label>
          Match mode
          <select name="matchMode" defaultValue={automation?.matchMode ?? "contains"}>
            <option value="contains">Comment contains the keyword</option>
            <option value="exact">Comment is exactly the keyword</option>
          </select>
        </label>
      </div>

      <label>
        Public replies (one per line, picked at random)
        <textarea
          name="publicReplies"
          defaultValue={automation?.publicReplies.join("\n") ?? "Sent it to your DMs! 💌\nCheck your inbox 📩\nJust sent you the link! ✨"}
        />
        <span className="help">Replying publicly boosts the post and tells other people what to comment. Leave empty to skip.</span>
      </label>

      <label>
        DM text
        <textarea
          name="dmText"
          required
          defaultValue={automation?.dmText ?? "Here's your {{offer}}, {{username}}! {{link}}"}
        />
        <span className="help">
          Placeholders: <code>{"{{username}}"}</code>, <code>{"{{link}}"}</code> and <code>{"{{offer}}"}</code>. If you leave out <code>{"{{link}}"}</code>, the link is added on its own line at the end.
        </span>
      </label>

      <div className="row">
        <label>
          Link
          <input type="url" name="dmLink" defaultValue={automation?.dmLink ?? ""} placeholder="https://..." />
        </label>
        <label>
          Button title (optional)
          <input type="text" name="dmButtonTitle" defaultValue={automation?.dmButtonTitle ?? ""} placeholder="Get the guide" maxLength={20} />
          <span className="help">If set, the DM is sent with a tappable button instead of a plain link.</span>
        </label>
      </div>

      <fieldset className="group">
        <legend>Opt-in (recommended)</legend>
        <label className="check">
          <input type="checkbox" name="requireOptIn" defaultChecked={automation?.requireOptIn ?? true} />
          Ask “want it?” with a Yes button before sending anything else
        </label>
        <span className="help">
          Meta allows exactly one automatic reply per comment. When they tap Yes, a 24-hour window opens for the link or the email question. This is the same consent step ManyChat uses, and it is what keeps the account clear of spam flags.
        </span>
        <div className="row">
          <label>
            Opt-in question
            <textarea
              name="optInPrompt"
              defaultValue={automation?.optInPrompt || "Hey {{username}}! Thanks so much for asking for the {{offer}}. Just to confirm, would you like me to send you the link?"}
            />
          </label>
          <label>
            Yes button (max 20 characters)
            <input type="text" name="optInButton" maxLength={20} defaultValue={automation?.optInButton || "Yes please!"} />
            <span className="help">Not tapping is the “no”. Typed replies like “no” or “stop” are honoured everywhere.</span>
          </label>
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>Email capture → GoHighLevel</legend>
        <label className="check">
          <input type="checkbox" name="collectEmail" defaultChecked={automation?.collectEmail ?? false} />
          Ask for an email address before sending the link
        </label>
        <span className="help">
          The first DM asks for their email. When they reply, the contact is created in GoHighLevel with the tags below and the DM text above (with the link) is sent.
        </span>
        <label>
          Email request message
          <textarea
            name="emailPrompt"
            defaultValue={automation?.emailPrompt || "Hey {{username}}! What's the best email to send the guide to? Just reply here and I'll send it right over 💌"}
          />
        </label>
        <div className="row">
          <label>
            If no email is found in their reply
            <input
              type="text"
              name="emailRetryText"
              defaultValue={automation?.emailRetryText || "Hmm, I didn't catch an email address. Could you send just the email?"}
            />
          </label>
          <label>
            GoHighLevel tags
            <input type="text" name="ghlTags" defaultValue={automation?.ghlTags.join(", ") ?? "instagram, convertlysocial"} placeholder="instagram, gut-guide" />
            <span className="help">Comma-separated. Use a tag to trigger a GHL workflow.</span>
          </label>
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>AI (needs ANTHROPIC_API_KEY)</legend>
        <label>
          Intent description
          <input
            type="text"
            name="intentDescription"
            defaultValue={automation?.intentDescription ?? ""}
            placeholder="someone asking for the gut health guide"
          />
          <span className="help">
            Comments that miss the keywords are checked against this. “omg I need that!” then still fires. Leave empty for keywords only.
          </span>
        </label>
        <label>
          FAQ for the email step
          <textarea
            name="aiFaq"
            defaultValue={automation?.aiFaq ?? ""}
            placeholder={"Why do you need my email? So I can send the PDF and a couple of follow-up tips. Unsubscribe anytime.\nIs it free? Yes, completely."}
          />
          <span className="help">
            If someone replies with a question instead of an email, Claude answers only from this text, then asks again. Leave empty to skip.
          </span>
        </label>
      </fieldset>

      <label className="check">
        <input type="checkbox" name="ignoreReplies" defaultChecked={automation?.ignoreReplies ?? true} />
        Ignore comments that are replies to other comments
      </label>
      <label className="check">
        <input type="checkbox" name="active" defaultChecked={automation?.active ?? true} />
        Active
      </label>

      <div className="actions">
        <button className="btn" type="submit">Save automation</button>
        <a className="btn secondary" href="/">Cancel</a>
      </div>
    </form>
  );
}
