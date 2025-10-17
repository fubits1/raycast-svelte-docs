import { ActionPanel, Action, List, showToast, Toast, Cache, Icon, Color } from '@raycast/api';
import React, { useState, useEffect } from 'react';
import { useFetch } from '@raycast/utils';
import { marked } from 'marked';

interface Arguments {
  query?: string;
}

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
  const lines = text.split('\n');

  let currentSection: Partial<DocSection> | null = null;
  let contentBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect section headers (markdown headers)
    if (line.startsWith('# ') && !line.includes('@sveltejs')) {
      // Save previous section
      if (currentSection && currentSection.title && contentBuffer.length > 0) {
        currentSection.content = contentBuffer.join('\n').trim();
        sections.push(currentSection as DocSection);
      }

      // Start new section
      const title = line.substring(2).trim();
      contentBuffer = [];

      currentSection = {
        title,
        content: '',
        type: detectType(title),
        url: generateUrl(title),
        keywords: extractKeywords(title),
      };
    } else if (line.startsWith('## ') || line.startsWith('### ')) {
      // Subsections - save as separate entries for better searchability
      if (currentSection && currentSection.title && contentBuffer.length > 0) {
        currentSection.content = contentBuffer.join('\n').trim();
        sections.push(currentSection as DocSection);
      }

      const level = line.startsWith('## ') ? 2 : 3;
      const title = line.substring(level + 1).trim();
      contentBuffer = [];

      currentSection = {
        title,
        content: '',
        type: detectType(title),
        url: generateUrl(title),
        keywords: extractKeywords(title),
      };
    } else if (currentSection) {
      // Add raw markdown content to preserve formatting
      contentBuffer.push(line);
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

function getMatchScore(section: DocSection, search: string): number {
  let score = 0;

  // Exact keyword match gets highest priority
  if (section.keywords.some((k) => k === search)) {
    score += 100;
  }

  // Keyword contains search gets high priority
  if (section.keywords.some((k) => k.includes(search))) {
    score += 50;
  }

  // Title exact match gets medium-high priority
  if (section.title.toLowerCase() === search) {
    score += 30;
  }

  // Title contains search gets medium priority
  if (section.title.toLowerCase().includes(search)) {
    score += 20;
  }

  // Content contains search gets low priority
  if (section.content.toLowerCase().includes(search)) {
    score += 10;
  }

  return score;
}

export default function Command({ arguments: args }: { arguments: Arguments }) {
  const [searchText, setSearchText] = useState(args.query || '');
  const [sections, setSections] = useState<DocSection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showDetail, setShowDetail] = useState(false);
  const [hasInitialQuery] = useState(!!args.query);
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>(undefined);

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

  // Filter and sort sections based on search
  const filteredSections = sections
    .filter((section) => {
      if (!searchText) return true;

      const search = searchText.toLowerCase();
      return (
        section.title.toLowerCase().includes(search) ||
        section.keywords.some((k) => k.includes(search)) ||
        section.content.toLowerCase().includes(search)
      );
    })
    .sort((a, b) => {
      if (!searchText) return 0;

      const search = searchText.toLowerCase();

      // Score each section based on match type
      const scoreA = getMatchScore(a, search);
      const scoreB = getMatchScore(b, search);

      return scoreB - scoreA; // Higher scores first
    });

  // Auto-select first result when search results change
  useEffect(() => {
    if (filteredSections.length > 0) {
      const firstItemId = filteredSections[0].title;
      setSelectedItemId(firstItemId);
      setShowDetail(true); // Auto-show detail view
    } else {
      setSelectedItemId(undefined);
    }
  }, [filteredSections]);

  return (
    <List
      isLoading={isLoading || isFetching}
      onSearchTextChange={(text) => {
        // Don't clear search text if we have an initial query and user hasn't typed anything
        if (hasInitialQuery && text === '' && searchText === args.query) {
          return;
        }
        setSearchText(text);
      }}
      searchBarPlaceholder="Search Svelte documentation..."
      isShowingDetail={showDetail}
      selectedItemId={selectedItemId}
      onSelectionChange={(id) => setSelectedItemId(id || undefined)}
      throttle
    >
      {filteredSections.map((section, index) => (
        <List.Item
          key={index}
          id={section.title}
          title={section.title}
          subtitle={section.type}
          icon={{ source: getIcon(section.type), tintColor: getColor(section.type) }}
          accessories={[{ text: `${section.content.split('\n').length} lines` }]}
          detail={<List.Item.Detail markdown={section.content} />}
          actions={
            <ActionPanel>
              <Action
                title={showDetail ? 'Hide Detail' : 'Show Detail'}
                icon={showDetail ? Icon.EyeSlash : Icon.Eye}
                onAction={() => setShowDetail(!showDetail)}
                shortcut={{ modifiers: ['cmd'], key: 'd' }}
              />
              <Action.OpenInBrowser url={section.url} shortcut={{ modifiers: ['cmd'], key: 'b' }} />
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
