import { ActionPanel, Action, List, showToast, Toast, Cache, Icon, Color } from '@raycast/api';
import React, { useState, useEffect } from 'react';
import { useFetch } from '@raycast/utils';
import { marked } from 'marked';
import Fuse from 'fuse.js';

// Enable GFM support
marked.use({
  gfm: true,
});

interface Arguments {
  query?: string;
}

const DOCS_URL = 'https://svelte.dev/llms-full.txt';
const cache = new Cache();
const CACHE_KEY = 'svelte-docs';
const CACHE_EXPIRY_KEY = 'svelte-docs-expiry';
const CACHE_DURATION = 1 * 60 * 60 * 1000; // 1 hour

function isCacheValid(): boolean {
  const cached = cache.get(CACHE_KEY);
  const expiry = cache.get(CACHE_EXPIRY_KEY);

  if (!cached || !expiry) return false;

  return Date.now() < parseInt(expiry);
}

interface DocSection {
  title: string;
  content: string;
  type: 'module' | 'keyword' | 'component' | 'concept' | 'config' | 'hook';
  url: string;
  keywords: string[];
}

function parseDocsText(text: string): DocSection[] {
  const sections: DocSection[] = [];
  const lines = text.split('\n');

  let currentSection: Partial<DocSection> | null = null;
  let contentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this is a heading (starts with #)
    if (line.match(/^#{1,3}\s+/)) {
      // Save previous section
      if (currentSection && currentSection.title && contentLines.length > 0) {
        currentSection.content = contentLines.join('\n').trim();
        sections.push(currentSection as DocSection);
      }

      // Start new section
      const title = line.replace(/^#{1,3}\s+/, '');
      contentLines = [];

      currentSection = {
        title,
        content: '',
        type: detectType(title),
        url: generateUrl(title),
        keywords: extractKeywords(title),
      };
    } else if (currentSection) {
      contentLines.push(line);
    }
  }

  // Save last section
  if (currentSection && currentSection.title && contentLines.length > 0) {
    currentSection.content = contentLines.join('\n').trim();
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
    return 'keyword';
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
    case 'keyword':
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
    case 'keyword':
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

// Fuse.js configuration for fuzzy search
const fuseOptions = {
  keys: [
    { name: 'keywords', weight: 0.4 },
    { name: 'title', weight: 0.3 },
    { name: 'content', weight: 0.2 },
    { name: 'type', weight: 0.1 },
  ],
  threshold: 0.4, // Lower = more strict matching
  includeScore: true,
  includeMatches: true,
  minMatchCharLength: 2,
  ignoreLocation: true,
  findAllMatches: true,
};

export default function Command({ arguments: args }: { arguments: Arguments }) {
  const [searchText, setSearchText] = useState(args.query || '');
  const [sections, setSections] = useState<DocSection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showDetail, setShowDetail] = useState(false);
  const [hasInitialQuery] = useState(!!args.query);
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [hasAutoSelected, setHasAutoSelected] = useState(false);

  // Fetch docs
  const {
    data,
    isLoading: isFetching,
    error,
  } = useFetch(DOCS_URL, {
    execute: !isCacheValid(),
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

        // Try cache first
        if (isCacheValid()) {
          docsText = cache.get(CACHE_KEY)!;
        } else if (data) {
          docsText = String(data);
          cache.set(CACHE_KEY, docsText);
          cache.set(CACHE_EXPIRY_KEY, (Date.now() + CACHE_DURATION).toString());
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

  // Use Fuse.js for fuzzy search
  const fuse = new Fuse(sections, fuseOptions);

  const filteredSections = searchText
    ? fuse.search(searchText).map((result) => result.item)
    : sections;

  // Auto-select first result when search results change (only once per search)
  useEffect(() => {
    if (filteredSections.length > 0 && !hasAutoSelected) {
      setSelectedItemId('0');
      setShowDetail(true); // Auto-show detail view
      setHasAutoSelected(true);
    } else if (filteredSections.length === 0) {
      setSelectedItemId('');
      setHasAutoSelected(false);
    }
  }, [filteredSections, hasAutoSelected]);

  return (
    <List
      isLoading={isLoading || isFetching}
      onSearchTextChange={(text) => {
        // Don't clear search text if we have an initial query and user hasn't typed anything
        if (hasInitialQuery && text === '' && searchText === args.query) {
          return;
        }
        setSearchText(text);
        setHasAutoSelected(false); // Reset auto-selection for new search
      }}
      searchBarPlaceholder="Search Svelte documentation..."
      isShowingDetail={showDetail}
      selectedItemId={selectedItemId}
      onSelectionChange={(id) => setSelectedItemId(id || '')}
      throttle
    >
      {filteredSections.map((section, index) => (
        <List.Item
          key={index}
          id={index.toString()}
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
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
