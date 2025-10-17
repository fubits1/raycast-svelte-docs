import { ActionPanel, Action, List, showToast, Toast, Cache, Icon, Color } from '@raycast/api';
import React, { useState, useEffect } from 'react';
import { useFetch } from '@raycast/utils';
import { marked } from 'marked';

const DOCS_URL = 'https://svelte.dev/llms-full.txt';
const cache = new Cache();

interface DocSection {
  title: string;
  content: string;
  type: 'module' | 'function' | 'component' | 'concept' | 'config' | 'hook';
  url: string;
  keywords: string[];
}

function parseDocsText(text: string): DocSection[] {
  const sections: DocSection[] = [];

  // Use marked to parse the markdown and extract headers
  const tokens = marked.lexer(text);

  let currentSection: Partial<DocSection> | null = null;
  let contentBuffer: string[] = [];

  for (const token of tokens) {
    if (token.type === 'heading' && token.depth <= 3) {
      // Save previous section
      if (currentSection && currentSection.title && contentBuffer.length > 0) {
        currentSection.content = contentBuffer.join('\n').trim();
        sections.push(currentSection as DocSection);
      }

      // Start new section
      const title = token.text;
      contentBuffer = [];

      currentSection = {
        title,
        content: '',
        type: detectType(title),
        url: generateUrl(title),
        keywords: extractKeywords(title),
      };
    } else if (currentSection) {
      // Add content to current section
      if (token.type === 'paragraph') {
        contentBuffer.push(token.text);
      } else if (token.type === 'code') {
        contentBuffer.push(`\`\`\`${token.lang || ''}\n${token.text}\n\`\`\``);
      } else if (token.type === 'list') {
        const listItems = token.items.map((item: any) => `- ${item.text}`).join('\n');
        contentBuffer.push(listItems);
      }
    }
  }

  // Save last section
  if (currentSection && currentSection.title && contentBuffer.length > 0) {
    currentSection.content = contentBuffer.join('\n').trim();
    sections.push(currentSection as DocSection);
  }

  return sections;
}

function detectType(title: string): DocSection['type'] {
  const lower = title.toLowerCase();

  if (lower.includes('$app') || lower.includes('@sveltejs') || lower.includes('import')) {
    return 'module';
  }
  if (lower.match(/^[a-z]+$/)) {
    return 'function';
  }
  if (lower.includes('component') || lower.includes('element')) {
    return 'component';
  }
  if (lower.includes('config') || lower.includes('adapter')) {
    return 'config';
  }
  if (lower.includes('hook')) {
    return 'hook';
  }

  return 'concept';
}

function generateUrl(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  if (title.includes('$app')) {
    return `https://svelte.dev/docs/kit/${slug}`;
  }
  if (title.includes('@sveltejs')) {
    return `https://svelte.dev/docs/kit/${slug}`;
  }

  return `https://svelte.dev/docs/kit/${slug}`;
}

function extractKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9$]+/)
    .filter((word) => word.length > 2);
}

function getIcon(type: DocSection['type']): Icon {
  switch (type) {
    case 'module':
      return Icon.Box;
    case 'function':
      return Icon.Code;
    case 'component':
      return Icon.Layers;
    case 'config':
      return Icon.Gear;
    case 'hook':
      return Icon.Link;
    default:
      return Icon.Book;
  }
}

function getColor(type: DocSection['type']): Color {
  switch (type) {
    case 'module':
      return Color.Blue;
    case 'function':
      return Color.Purple;
    case 'component':
      return Color.Orange;
    case 'config':
      return Color.Green;
    case 'hook':
      return Color.Red;
    default:
      return Color.PrimaryText;
  }
}

export default function Command() {
  const [searchText, setSearchText] = useState('');
  const [sections, setSections] = useState<DocSection[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch docs
  const {
    data,
    isLoading: isFetching,
    error,
  } = useFetch(DOCS_URL, {
    execute: !cache.has('svelte-docs'),
    onError: (error) => {
      showToast({
        style: Toast.Style.Failure,
        title: 'Failed to fetch docs',
        message: error.message,
      });
    },
  });

  useEffect(() => {
    async function loadDocs() {
      setIsLoading(true);

      try {
        let docsText: string;

        // Try to load from cache first
        const cached = cache.get('svelte-docs');
        if (cached) {
          docsText = cached;
        } else if (data) {
          docsText = String(data);
          cache.set('svelte-docs', docsText);
        } else {
          setIsLoading(false);
          return;
        }

        const parsed = parseDocsText(docsText);
        setSections(parsed);

        showToast({
          style: Toast.Style.Success,
          title: 'Docs loaded',
          message: `${parsed.length} sections indexed`,
        });
      } catch (error) {
        showToast({
          style: Toast.Style.Failure,
          title: 'Failed to parse docs',
          message: String(error),
        });
      } finally {
        setIsLoading(false);
      }
    }

    loadDocs();
  }, [data]);

  // Filter sections based on search
  const filteredSections = sections.filter((section) => {
    if (!searchText) return true;

    const search = searchText.toLowerCase();
    return (
      section.title.toLowerCase().includes(search) ||
      section.keywords.some((k) => k.includes(search)) ||
      section.content.toLowerCase().includes(search)
    );
  });

  return (
    <List
      isLoading={isLoading || isFetching}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search Svelte documentation..."
      throttle
    >
      {filteredSections.map((section, index) => (
        <List.Item
          key={index}
          title={section.title}
          subtitle={section.type}
          icon={{ source: getIcon(section.type), tintColor: getColor(section.type) }}
          accessories={[{ text: `${section.content.split('\n').length} lines` }]}
          actions={
            <ActionPanel>
              <Action.OpenInBrowser url={section.url} />
              <Action.CopyToClipboard
                title="Copy Content"
                content={section.content}
                shortcut={{ modifiers: ['cmd'], key: 'c' }}
              />
              <Action.CopyToClipboard
                title="Copy URL"
                content={section.url}
                shortcut={{ modifiers: ['cmd', 'shift'], key: 'c' }}
              />
              <Action
                title="Clear Cache"
                icon={Icon.Trash}
                shortcut={{ modifiers: ['cmd', 'shift'], key: 'r' }}
                onAction={() => {
                  cache.remove('svelte-docs');
                  showToast({
                    style: Toast.Style.Success,
                    title: 'Cache cleared',
                    message: 'Docs will be refetched on next load',
                  });
                }}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
