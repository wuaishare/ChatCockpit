import path from "node:path";

/**
 * Repository text formats that are safe for bounded UTF-8 read/write helpers.
 *
 * Keep this list format-oriented rather than product-oriented so Files read and
 * write cannot silently drift apart as new development ecosystems are used.
 */
export const TEXT_LIKE_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".htm",
  ".xml",
  ".svg",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".py",
  ".php",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".swift",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".m",
  ".mm",
  ".ini",
  ".toml",
  ".cfg",
  ".conf",
  ".csv",
  ".properties",
  ".gradle",
  ".groovy",
  ".graphql",
  ".gql",
  ".proto",
  ".sql",
  ".vue",
  ".svelte",
  ".astro",
  ".strings",
  ".stringsdict",
  ".xcconfig",
  ".pbxproj",
  ".plist",
  ".entitlements",
  ".lock"
]);

export const TEXT_LIKE_FILENAMES = new Set([
  "Dockerfile",
  "Makefile",
  "Rakefile",
  "Gemfile",
  "Podfile",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".prettierrc",
  ".eslintrc",
  ".npmrc",
  ".nvmrc",
  ".ruby-version",
  ".python-version"
]);

export function isTextLikeFilePath(filePath: string): boolean {
  const basename = path.basename(filePath);
  if (TEXT_LIKE_FILENAMES.has(basename)) return true;
  return TEXT_LIKE_EXTENSIONS.has(path.extname(basename).toLowerCase());
}
