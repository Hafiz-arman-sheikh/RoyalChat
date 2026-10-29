# RoyalChat — Messenger Web App

RoyalChat is a browser-based messenger interface built with HTML, CSS, and vanilla JavaScript. It uses Supabase for authentication, chat data, and live updates.

## Features

- Create an account and log in
- Browse people and conversations
- Send and view messages
- Live updates through Supabase Realtime
- Responsive messenger layout
- Session handling and user feedback

## Technology

- HTML5
- CSS3
- Vanilla JavaScript with ES modules
- Supabase JavaScript client
- Supabase Auth, database, and Realtime

## Run locally

1. Clone this repository.
2. Open the project folder in a local development server that supports ES modules.
3. Check the Supabase project URL and publishable key in `app.js`.
4. In Supabase, configure the required tables, authentication settings, and Row Level Security policies before testing accounts and messages.

## Security notes

The browser-side Supabase publishable key is intended for client apps, but database access must be protected by correct Row Level Security policies. Never put a Supabase service-role key or other server secrets in browser code. Test access rules with separate accounts before using real messages.

## Developer

[Hafiz Arman Sheikh](https://github.com/Hafiz-arman-sheikh)
