-- GitHub username, captured at GitHub sign-in (auth.ts `signInWithGitHub`
-- reads it from the OAuth user_metadata). Lets the app invite a teammate to
-- a project's repo as a collaborator by username via the GitHub API, rather
-- than everyone adding each other by hand on github.com.
alter table profiles add column if not exists github_login text;
