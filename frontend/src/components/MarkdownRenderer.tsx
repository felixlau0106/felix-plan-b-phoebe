// frontend/components/chat/MarkdownRenderer.tsx
import React from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import tomorrow from "react-syntax-highlighter/dist/esm/styles/prism/tomorrow";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math"; // remark-math (finds $...$ / $$...$$, tags as math nodes)
import rehypeKatex from "rehype-katex"; // rehype-katex (renders math nodes to HTML with KaTeX styles)
import remarkBreaks from "remark-breaks"; // remark-breaks (converts single line breaks to <br> tags)
import { useMemo } from "react";

interface MarkdownRendererProps {
  content: string; // The markdown content to render
}


function normalizeMathLines(text: string): string {
  if (!text) return text;
  const lines = text.split("\n");
  const out: string[] = [];
  let inFence = false;
  let inMath = false;
  
  for (const line of lines) {
    const trimmed = line.trim();

    // Code fence
    if (/^```/.test(trimmed)) { 
      inFence = !inFence;
      out.push(line);
      continue;
    }

    // Stay the fuck out of the code fence
    if (inFence) {
      out.push(line);
      continue;
    }

    // check if $$ is balanced in the line. If it is, we can just push the line as-is.
    if ((trimmed.match(/\$\$/g) || []).length % 2 === 0) {
      out.push(line);
      continue;
    }
    
    // Lone delimiter line = open or close
    if (trimmed === "$$") { // If the line is exactly $$, we can just push it as-is.
      inMath = !inMath; // flip because it is either opening or closing a math block
      out.push(line);
      continue;
    }

    // This fucker starts with $$ but is not a lone delimiter line
    if (
      !inMath &&
      trimmed.startsWith("$$")&&
      trimmed !== "$$" &&
      !trimmed.slice(2).trim().includes("$$")
    ) {
      out.push("$$"); // Push a line with just $$ to open the math block
      out.push(trimmed.slice(2).trim()); // Push the rest of the line after $$ as a new line
      inMath = true; // We are now inside a math block
      continue;
    }


    if (
      !trimmed.startsWith("$$") &&
      trimmed.includes("$$")) { // If the line does not start with $$, but contains $$ somewhere in the middle
        if (inMath) {
          const idx = trimmed.indexOf("$$"); // Find the index of the first occurrence of $$
          const before = trimmed.slice(0, idx).trim(); // Get the part of the line before $$
          const after = trimmed.slice(idx + 2).trim(); // Get the part of the line after $$
          if (before) out.push(before); // Push the part before $$ as a new line
          out.push("$$"); // Push a line with just $$ to close the math block
          if (after) out.push(after); // Push the part after $$ as a new line
          inMath = false; // Toggle the inMath state
          continue;
        } else {
          out.push(line.replace("$$", "`double-dollar`")); // Replace $$ with `double-dollar` to avoid KaTeX accidentally rendering it as math.
          continue;
        }
      }

    out.push(line);
  }

  return out.join("\n");
}

function preserveBlankLines(text: string): string {
  if (!text) return text;

  const lines = text.split("\n"); // Split the text into lines to process each line individually
  const out: string[] = [];
  
  let inFence = false; // inside ``` code block
  let inMath = false; // inside $$ ... $$ math block
  let thisLineIsBullet = false; // Track if the current line is a bullet point (for lists)
  let lastLineWasBullet = false; // Track if the last line was a bullet point (for lists)

  for (const line of lines) {
    const trimmed = line.trim();

    thisLineIsBullet = trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("+ ") || /^\d+\.\s/.test(trimmed);
    
    // Toggle fence when line starts with triple backtick (``` or ```lang)
    if (/^```/.test(trimmed)) {
      inFence = !inFence; // A smart toggle that works for both start and end of the code block.
      out.push(line); // push the line in between the code block, including the ``` line itself
      continue;
    }

    // Toggle math block: line that is only $$
    if (!inFence && trimmed === "$$") {
      inMath = !inMath;
      out.push(line);
      continue;
    }

    // Inside code of math: leave exactly as typed
    if (inFence || inMath) {
      out.push(line);
      continue;
    }

    // Blank line (empty or only spaces) -> keep as a real line with NBSP
    if (trimmed === "") {
      out.push("\u00A0"); // Non-breaking space - invisible but not "empty", so it will be preserved in the final output.
      continue; // For future Felix. continue DOES NOT mean run the next line of code. It means skip the rest of the loop body and go to the next iteration of the loop (next line).
      }

    
    if (lastLineWasBullet && !thisLineIsBullet) {
      out.push(""); // End the list with ""
    }

    lastLineWasBullet = thisLineIsBullet; // Update the last line bullet status
    out.push(line); // Normal line
  }

  return out.join("\n"); // Join the processed lines back into a single string with newlines, this combines with the \u00A0 to preserve blank lines in the final output.
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  // Arguments of useMemo: 1st = A function React will call to get the value, 2nd = An array of dependencies that will trigger a re-render if changed. In this case, we want to re-render if content changes.
  // MarkdownRenderer could re-run for some reason (like a parent re-rendering), but we don't want to re-process the content unless it actually changed. This is an optimization.
  const rendered = useMemo(
    () => preserveBlankLines(normalizeMathLines(content)),
    [content]
  );
  
  const [showCode, setShowCode] = React.useState(true); // State to toggle code visibility
  const [showLineNumbers, setShowLineNumbers] = React.useState(true); // State to toggle line numbers
  const markdownComponents: Record<string, React.ComponentType<any>> = {
    code: ({ inline, className, children, ...props }) => {
      const match = /language-(\w+)/.exec(className || ""); // className here is the language name after ``` in the original text, the remarkGfm plugin converts it to className like "language-js"
      const isInline = !className && inline !== false; // If (inline) will never being triggered because react-markdown v8+ (and even v6+) stopped passing inline as a boolean prop in the same reliable way older versions did.
      if (isInline) {
        // Nice Grok style (orange color on official website) inline code
        return (
          <code
            className="text-xs px-1 rounded-sm font-mono bg-orange-300/10 text-orange-300 whitespace-pre-wrap"
            {...props}
          >
            {children}
          </code>
        );
      }
      if (match) {
        if (match[1] === "markdown") {
          const innerContent = String(children).trim().replace(/\n$/, ""); // Trim extra whitespace/newlines
          // Use a shallow copy of components to avoid deep recursion (omit code/table to prevent loops)
          const innerComponents = { ...markdownComponents };
          delete innerComponents.code; // Prevent nested code from recursing, keep basics like p, ul, ol, a, h1, table, etc.
          return (
            <div className="my-4 border border-neutral-900 rounded-xl overflow-hidden">
              {" "}
              {/* Outer container */}
              <div className="flex items-center justify-between px-4 py-2 bg-black border-b border-neutral-900 rounded-t-xl">
                {" "}
                {/* Header */}
                <span className="text-sm text-gray-400 tracking-wider">
                  {" "}
                  {/* Language label */}
                  {match[1]}
                </span>
                {/* Buttons */}
                {/* Copy Button */}
                <button
                  title="Copy to clipboard"
                  className="text-xs text-gray-500 hover:text-gray-300 transition-all px-2 py-1 rounded hover:bg-gray-800/50 flex items-center gap-1"
                  onClick={(e) => {
                    const btn = e.currentTarget; // define btn as currentTarget, which is the button element
                    const originalText = btn.textContent; // Store original text: "Copy"
                    navigator.clipboard.writeText(
                      // Copy inner markdown content
                      String(children).replace(/\n$/, "") // Remove trailing newline, children is the inner markdown text
                    );
                    btn.textContent = "Copied!"; // Change button text to "Copied!"
                    setTimeout(() => {
                      btn.textContent = originalText; // Revert button text after 1.5s
                    }, 1500);
                  }}
                >
                  Copy
                </button>
              </div>
              <div className="p-4 bg-black">
                {/* Render the inner markdown */}
                <ReactMarkdown
                  components={innerComponents}
                  remarkPlugins={[remarkGfm, remarkBreaks]}
                >
                  {innerContent}
                </ReactMarkdown>
              </div>
            </div>
          );
        }
        // Other languages (Pythong, JSX, JS, etc.)

        return (
          <div className="my-4 border border-neutral-900 rounded-xl overflow-hidden">
            {" "}
            {/* Outer container */}
            <div className="flex items-center justify-between px-4 py-2 bg-black border-b border-neutral-900 rounded-t-xl">
              {" "}
              {/* Header */}
              <span className="text-sm text-gray-400 tracking-wider">
                {" "}
                {/* Language label */}
                {match[1]}
              </span>
              {/* Buttons */}
              <div className="flex items-center gap-3">
                {/* Show/Hide Line Number Button */}
                <button
                  title="Show/hide line number"
                  className="text-xs text-gray-500 hover:text-gray-300 transition-all px-2 py-1 rounded hover:bg-gray-800/50"
                  onClick={() => setShowLineNumbers((prev) => !prev)} // Set showLineNumbers state to opposite
                >
                  {showLineNumbers ? "Hide" : "Show"} LN
                </button>
                {/* Hide/Show CodeButton */}
                <button
                  title="Show/hide code"
                  className="text-xs text-gray-500 hover:text-gray-300 transition-all px-2 py-1 rounded hover:bg-gray-800/50"
                  onClick={() => setShowCode((prev) => !prev)} // Set showCode state to opposite
                >
                  {showCode ? "Hide" : "Show"} Code
                </button>
                {/* Copy Button */}
                <button
                  title="Copy to clipboard"
                  className="text-xs text-gray-500 hover:text-gray-300 transition-all px-2 py-1 rounded hover:bg-gray-800/50 flex items-center gap-1"
                  onClick={(e) => {
                    const btn = e.currentTarget;
                    const originalText = btn.textContent;
                    navigator.clipboard.writeText(
                      String(children).replace(/\n$/, "")
                    );
                    btn.textContent = "Copied!";
                    setTimeout(() => {
                      btn.textContent = originalText;
                    }, 1500);
                  }}
                >
                  Copy
                </button>
              </div>
            </div>
            {/* The actual highlighted code */}
            {showCode && ( // Only render if showCode is true
              <SyntaxHighlighter
                language={match[1]} // Language from ```lang
                style={tomorrow} // Prism style
                PreTag="div" // Use div to allow custom styling
                customStyle={{
                  margin: 0,
                  borderRadius: 0,
                  padding: "1rem",
                  fontSize: "0.875rem",
                  backgroundColor: "rgb(0, 0, 0)",
                }}
                wrapLongLines={true} // Wrap long lines
                showLineNumbers={showLineNumbers} // Show line numbers based on state
              >
                {String(children).replace(/\n$/, "")}
              </SyntaxHighlighter>
            )}
          </div>
        );
      }
      // Fallback for code blocks without specified language
      return (
        // Same styling as inline code but block display
        <pre className="bg-gray-700/40 px-[0.2rem] py-px rounded text-[0.75rem] font-mono leading-none align-middle border border-gray-600/50 shadow-sm inline-flex">
          {String(children).replace(/\n$/, "")}
        </pre>
      );
    },
    p: ({ children }) => <div className="mb-1.5 leading-snug">{children}</div>, // Paragraphs with margin
    ul: ({ children }) => <ul className="list-disc ml-4 mb-2">{children}</ul>, // Unordered lists with margin and indent
    ol: ({ children }) => (
      <ol className="list-decimal ml-4 mb-2">{children}</ol> // Ordered lists with margin and indent
    ),
    // Links with blue color, underline, and hover effect for visibility
    a: ({ href, children }) => {
      const isYouTube =
        href?.includes("youtube.com/watch") || href?.includes("youtu.be") || href?.includes("youtube.com/playlist");

      if (isYouTube) {
        const videoIdMatch = href?.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]+)/);
        const playlistMatch = href?.match(/list=([A-Za-z0-9_-]+)/);

        if (videoIdMatch) {
        const videoId = videoIdMatch ? videoIdMatch[1] : null; // Extract video ID
        if (videoId) {
          return (
            <div className="my-2">
              <iframe
                src={`https://www.youtube.com/embed/${videoId}`}
                title="YouTube video player"
                className="w-full aspect-video rounded-md shadow-md"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          );
        }
      }
      else if (playlistMatch) {
        const playlistId = playlistMatch[1]; // Extract playlist ID
        return (
          <div className="my-2">
            <iframe
              src={`https://www.youtube.com/embed/videoseries?list=${playlistId}`}
              title="YouTube playlist player"
              className="w-full aspect-video rounded-md shadow-md"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        );
      }
    }
      // Fallback: normal link
      return (
        <a
          href={href}
          className="text-blue-400 hover:text-blue-300 underline decoration-2"
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      );
    },
    // Table container with scroll and max-width to fit bubble
    table: ({ children }) => (
      <div className="overflow-x-auto my-2">
        <table className="w-full border-collapse border border-gray-600 rounded-md bg-gray-800">
          {children}
        </table>
      </div>
    ),
    // Table header row
    thead: ({ children }) => <thead className="bg-gray-700">{children}</thead>,
    // Table body
    tbody: ({ children }) => <tbody>{children}</tbody>,
    // Table rows
    tr: ({ children }) => (
      <tr className="border-b border-gray-600 hover:bg-gray-700/50">
        {children}
      </tr>
    ),
    // Header cells (bold, centered)
    th: ({ children }) => (
      <th className="border border-gray-600 px-2 py-1 text-left font-semibold text-sm">
        {children}
      </th>
    ),
    // Data cells (padded, wrap text)
    td: ({ children }) => (
      <td className="border border-gray-600 px-2 py-1 text-sm break-all">
        {children}
      </td>
    ),
    img: ({ node, ...props }) => (
      <img
        {...props}
        className="max-w-full h-auto rounded-md my-2 shadow-md"
        alt="img"
        loading="lazy"
        onError={(e) => (e.currentTarget.style.display = "none")}
      />
    ),
  };
  return (
    // Render the markdown content with custom components and plugins
    <ReactMarkdown
      components={markdownComponents} // The contents converted to React components
      remarkPlugins={[
        remarkGfm, // GFM for tables, task lists; math for $...$ and $$...$$ <-- converts to nodes that SyntaxHighlighter and rehypeKatex can understand
        remarkBreaks, // Without this, newlines are ignored.
        [remarkMath, { singleDollarTextMath: false }] // <-- CRITICAL: disable singleDollarTextMath to avoid false positives on prices
        ]} 
      rehypePlugins={[
        [
          rehypeKatex, // KaTeX plugin to render math
          {
            output: "html", // Best for accessibility
            throwOnError: false, // ← CRITICAL: prevents crashes on typos
            errorColor: "#cc0000", // Red errors like official Grok
          },
        ],
      ]}
    >
      {rendered}
    </ReactMarkdown>
  );
}
