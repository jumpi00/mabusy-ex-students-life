# MABusy[ex]Students_life

Private archive of our monthly calls. Before each call everyone uploads a selfie,
answers the questions and shares photos, text and links. Everything unlocks for
everybody at the call time.

Static site (vanilla HTML/CSS/JS, no build) on GitHub Pages + Supabase
(magic-link auth, Postgres with row-level security, private storage bucket).

## Setup

1. Supabase → SQL Editor: run `sql/001_schema.sql`, then the members list
   (`sql/002_members.local.sql`, kept out of git).
2. Authentication → URL Configuration: set the Site URL to the Pages URL and
   add it (plus `http://localhost:5180/`) to Redirect URLs.
3. Authentication → Emails → SMTP: configure a custom SMTP sender (the built-in
   one only delivers to the project's team members).
4. Optional: add `{{ .Token }}` to the Magic Link email template so people can
   type the code instead of opening the link.

The unlock is enforced by the database: before `reveal_at` nobody, admin included,
can read other people's rows or files.
