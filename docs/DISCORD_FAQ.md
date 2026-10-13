# Discord FAQ

Ready-to-post FAQ for the support server (https://discord.gg/P7ycBcBqtn). Each block below fits in one Discord message (under 2000 characters): copy everything between the horizontal rules.

---

## ❓ Dispatch FAQ — Getting started

**How do I add Dispatch to my server?**
Use **Add to Discord** on https://dispatch.haxurus.com or on the bot's profile. You need the *Manage Server* permission on that server. Dispatch never asks for Administrator.

**How do I set up my first ticket system?**
1. Sign in at https://dispatch.haxurus.com/dashboard with Discord and pick your server.
2. **Ticket setup** → create a category: name, staff roles and (optionally) the Discord category where ticket channels go.
3. **Panels** → create a ticket panel, choose the categories, the channel, and press **Publish**.
That's it: members open tickets from the panel.

**I don't see my server in the dashboard.**
- The bot must be in the server.
- You need to be the owner, have *Administrator* or *Manage Server*, or have a role that was given dashboard access (**Overview** → *Dashboard permissions by role*).
- Log out and sign in again to refresh your server list.

**How do I change the bot's language?**
**System and menu** → **Bot language** (English or Italian). Then republish your panels and main menu so the messages already in Discord are updated. The dashboard has its own IT/EN switch in the sidebar.

---

## ❓ Dispatch FAQ — Tickets

**The bot doesn't create the ticket channel / "This interaction failed".**
Check the bot's role: it needs *View Channels, Manage Channels, Manage Roles, Send Messages, Manage Messages, Embed Links, Attach Files, Read Message History*. Also check:
- the Discord category you chose has fewer than **50 channels** (Discord's limit);
- the bot can see that category.

**Members get "Opening is temporarily limited" or "limit of open tickets".**
That's the anti-spam working: cooldown after opening, maximum open tickets per member and attempt limits. Adjust them per category in **Ticket setup** and globally in **System and menu** → *Global anti-spam*. Blacklisted members (**Blacklist**) cannot open tickets at all.

**The "Staff thread" button gives an error.**
Staff threads are part of the **Plus** plan and above. If you have it, give the bot's role *Create Private Threads*, *Send Messages in Threads* and *Manage Threads*. Staff threads automatically add every member of the category's staff roles; the person who opened the ticket never sees them.

**Where do transcripts go?**
Per category, in **Ticket setup**: automatic transcript on close, sent to an archive channel, to the member by DM, and/or kept encrypted in the dashboard. If the DM doesn't arrive, the member has DMs from server members turned off.

**How do I see what happens to tickets?**
**System and menu** → **Ticket log**: pick a channel and the events to record (opened, claimed, closed, transcripts, feedback…). Use *Send test message* to check permissions.

---

## ❓ Dispatch FAQ — Forms, ratings and limits

**Form questions don't arrive in DM.**
The member must allow DMs from server members (Server settings → Privacy). Otherwise switch the form to ephemeral delivery in **Forms**.

**How do ratings and the moderator leaderboard work?**
When a ticket is closed the member can rate it 1–5 ★; the rating goes to the moderator who claimed it (or closed it). The leaderboard is part of the **Pro** plan: in **Analytics** → *Moderator leaderboard* choose a channel and a weekly and/or monthly schedule. A leaderboard is posted after its period ends; *Send now* posts one immediately.

**Is Dispatch free? What do the paid plans add?**
Free covers tickets, panels, forms, transcripts, ticket log and ratings, with limits (3 categories, 2 panels, 2 forms, 30-day retention). **Plus** adds SLAs, escalation, auto-close and staff threads; **Pro** the moderator leaderboard and the closed-ticket category; **Brand** a custom bot nickname, banner and panel footer. Limits grow with each plan: https://dispatch.haxurus.com/en/pricing — the dashboard **Overview** shows your plan and usage.

**How do I upgrade?**
Contact us (details on the pricing page): plans are activated by hand for your server, monthly or yearly, with discounts for several servers. Dispatch is open source (AGPL-3.0): https://github.com/haxurus/Dispatch

---

## ❓ Dispatch FAQ — Privacy, bugs and ideas

**What data does Dispatch keep, and for how long?**
Ticket details, transcripts, form answers and notes (encrypted), for the retention you set in **System and menu** → *Automatic retention*, up to your plan's limit (Free 30 days, Plus 90, Pro 365, Brand unlimited). When the bot is removed from a server, all its data is deleted after **30 days**. Full details: https://dispatch.haxurus.com/en/legal

**I want my data deleted.**
Ask your server's admins, or write to haxurus@icloud.com.

**I found a bug / I have an idea.**
Open an issue on GitHub: https://github.com/haxurus/Dispatch/issues/new/choose — include the steps to reproduce and never paste tokens or other people's messages. Security problems: report them privately at https://github.com/haxurus/Dispatch/security/advisories/new

**Can I host Dispatch myself?**
Yes, see https://github.com/haxurus/Dispatch/blob/main/docs/DEPLOYMENT.md and the rules in docs/DISTRIBUTION.md (your own bot name, your own privacy policy).

---
