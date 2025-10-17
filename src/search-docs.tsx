import { Action, ActionPanel, Cache, Color, Icon, List, showToast, Toast } from '@raycast/api';
import { useFetch } from '@raycast/utils';
import Fuse from 'fuse.js';
import { marked } from 'marked';
import { useEffect, useState } from 'react';

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

export interface DocSection {
  title: string;
  content: string;
  type:
    | 'rune'
    | 'directive'
    | 'block'
    | 'element'
    | 'module'
    | 'api'
    | 'concept'
    | 'config'
    | 'migration'
    | 'error'
    | 'styling'
    | 'testing'
    | 'typescript'
    | 'stores'
    | 'context'
    | 'lifecycle'
    | 'legacy';
  keywords: string[];
}

export function parseDocsText(text: string): DocSection[] {
  const sections: DocSection[] = [];
  const lines = text
    .replace(/(\[!NOTE\])/g, 'ℹ️')
    .replace(/(\[!WARNING\])/g, '⚠️')
    .replace(/(\[!TIP\])/g, '💡')
    .replace(/(\[!IMPORTANT\])/g, '🔥')
    .replace(/(\[!CAUTION\])/g, '🚨')
    .split('\n');

  let currentSection: Partial<DocSection> | null = null;
  let contentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this is a main heading (starts with # but not ##)
    if (line.match(/^#\s+/)) {
      // Save previous section
      if (currentSection && currentSection.title && contentLines.length > 0) {
        currentSection.content = contentLines.join('\n').trim();
        currentSection.type = detectType(currentSection.title, currentSection.content);
        sections.push(currentSection as DocSection);
      }

      // Start new section
      const title = line.replace(/^#\s+/, '');
      contentLines = [];

      currentSection = {
        title,
        content: '',
        type: 'concept', // Will be updated after content is parsed
        keywords: extractKeywords(title),
      };
    } else if (currentSection) {
      contentLines.push(line);
    }
  }

  // Save last section
  if (currentSection && currentSection.title && contentLines.length > 0) {
    currentSection.content = contentLines.join('\n').trim();
    currentSection.type = detectType(currentSection.title, currentSection.content);
    sections.push(currentSection as DocSection);
  }

  return sections;
}

export function detectType(title: string, content: string): DocSection['type'] {
  // Analyze actual content patterns dynamically
  const contentLower = content.toLowerCase();
  const titleLower = title.toLowerCase();

  // Extract patterns from content
  const hasCodeBlocks = contentLower.includes('```') || contentLower.includes('`');
  const hasImports = contentLower.includes('import ') || contentLower.includes('from ');
  const hasDollarSigns = contentLower.includes('$');
  const hasBrackets = contentLower.includes('{') && contentLower.includes('}');
  const hasAngleBrackets = contentLower.includes('<') && contentLower.includes('>');
  const hasColons = contentLower.includes(':');
  const hasParens = contentLower.includes('(') && contentLower.includes(')');

  // Pattern-based classification
  if (
    hasDollarSigns &&
    (contentLower.includes('$state') ||
      contentLower.includes('$derived') ||
      contentLower.includes('$effect') ||
      contentLower.includes('$props') ||
      contentLower.includes('$bindable') ||
      contentLower.includes('$inspect') ||
      contentLower.includes('$host'))
  ) {
    return 'rune';
  }

  if (
    hasColons &&
    (contentLower.includes('use:') ||
      contentLower.includes('bind:') ||
      contentLower.includes('transition:') ||
      contentLower.includes('animate:') ||
      contentLower.includes('style:') ||
      contentLower.includes('class:') ||
      contentLower.includes('in:') ||
      contentLower.includes('out:'))
  ) {
    return 'directive';
  }

  if (hasBrackets && (contentLower.includes('{#') || contentLower.includes('{@'))) {
    return 'block';
  }

  // Check for specific block patterns
  if (
    contentLower.includes('{#if') ||
    contentLower.includes('{#each') ||
    contentLower.includes('{#await') ||
    contentLower.includes('{#key') ||
    contentLower.includes('{#snippet') ||
    contentLower.includes('{@render') ||
    contentLower.includes('{@html') ||
    contentLower.includes('{@attach') ||
    contentLower.includes('{@const') ||
    contentLower.includes('{@debug')
  ) {
    return 'block';
  }

  if (hasAngleBrackets && contentLower.includes('svelte:')) {
    return 'element';
  }

  if (hasImports && (contentLower.includes('$app') || contentLower.includes('@sveltejs'))) {
    return 'module';
  }

  if (hasCodeBlocks && (contentLower.includes('function') || contentLower.includes('interface'))) {
    return 'api';
  }

  if (contentLower.includes('config') || contentLower.includes('adapter')) {
    return 'config';
  }

  if (contentLower.includes('migration') || contentLower.includes('upgrade')) {
    return 'migration';
  }

  if (contentLower.includes('error') || contentLower.includes('warning')) {
    return 'error';
  }

  // Check for styling patterns
  if (
    contentLower.includes('scoped styles') ||
    contentLower.includes('global styles') ||
    contentLower.includes('custom properties') ||
    contentLower.includes('css') ||
    contentLower.includes('style') ||
    contentLower.includes('styling')
  ) {
    return 'styling';
  }

  // Check for testing patterns
  if (
    contentLower.includes('testing') ||
    contentLower.includes('test') ||
    contentLower.includes('vitest') ||
    contentLower.includes('playwright') ||
    contentLower.includes('unit test') ||
    contentLower.includes('e2e')
  ) {
    return 'testing';
  }

  // Check for TypeScript patterns
  if (
    contentLower.includes('typescript') ||
    contentLower.includes('tsconfig') ||
    contentLower.includes('type safety') ||
    contentLower.includes('interface') ||
    contentLower.includes('generic') ||
    contentLower.includes('jsconfig')
  ) {
    return 'typescript';
  }

  // Check for stores patterns
  if (
    contentLower.includes('stores') ||
    contentLower.includes('writable') ||
    contentLower.includes('readable') ||
    contentLower.includes('derived store') ||
    contentLower.includes('store') ||
    contentLower.includes('reactive store')
  ) {
    return 'stores';
  }

  // Check for context patterns
  if (
    contentLower.includes('context') ||
    contentLower.includes('setcontext') ||
    contentLower.includes('getcontext') ||
    contentLower.includes('context api')
  ) {
    return 'context';
  }

  // Check for lifecycle patterns
  if (
    contentLower.includes('lifecycle') ||
    contentLower.includes('onmount') ||
    contentLower.includes('ondestroy') ||
    contentLower.includes('beforeupdate') ||
    contentLower.includes('afterupdate') ||
    contentLower.includes('tick')
  ) {
    return 'lifecycle';
  }

  // Check for legacy patterns
  if (
    contentLower.includes('legacy') ||
    contentLower.includes('deprecated') ||
    contentLower.includes('svelte 3') ||
    contentLower.includes('svelte 4') ||
    contentLower.includes('sapper') ||
    contentLower.includes('export let') ||
    contentLower.includes('reactive') ||
    contentLower.includes('slot')
  ) {
    return 'legacy';
  }

  return 'concept';
}

function extractKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9$]+/)
    .filter((word) => word.length > 2);
}

function getIcon(type: DocSection['type']): Icon {
  switch (type) {
    case 'rune':
      return Icon.Bolt;
    case 'directive':
      return Icon.Code;
    case 'block':
      return Icon.Code;
    case 'element':
      return Icon.Tag;
    case 'module':
      return Icon.Box;
    case 'api':
      return Icon.Terminal;
    case 'concept':
      return Icon.Book;
    case 'config':
      return Icon.Gear;
    case 'migration':
      return Icon.ArrowRight;
    case 'error':
      return Icon.ExclamationMark;
    case 'styling':
      return Icon.Brush;
    case 'testing':
      return Icon.CheckCircle;
    case 'typescript':
      return Icon.Code;
    case 'stores':
      return Icon.Box;
    case 'context':
      return Icon.Link;
    case 'lifecycle':
      return Icon.Clock;
    case 'legacy':
      return Icon.Clock;
    default:
      return Icon.Book;
  }
}

function getColor(type: DocSection['type']): Color {
  switch (type) {
    case 'rune':
      return Color.Orange;
    case 'directive':
      return Color.Purple;
    case 'block':
      return Color.Blue;
    case 'element':
      return Color.Green;
    case 'module':
      return Color.Blue;
    case 'api':
      return Color.SecondaryText;
    case 'concept':
      return Color.PrimaryText;
    case 'config':
      return Color.Green;
    case 'migration':
      return Color.Orange;
    case 'error':
      return Color.Red;
    case 'styling':
      return Color.Magenta;
    case 'testing':
      return Color.Green;
    case 'typescript':
      return Color.Blue;
    case 'stores':
      return Color.Purple;
    case 'context':
      return Color.Yellow;
    case 'lifecycle':
      return Color.SecondaryText;
    case 'legacy':
      return Color.SecondaryText;
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
              <Action.CopyToClipboard
                title="Copy Content"
                content={section.content}
                shortcut={{ modifiers: ['cmd'], key: 'c' }}
              />
              <Action
                title="Refresh Docs"
                icon={Icon.ArrowClockwise}
                shortcut={{ modifiers: ['cmd'], key: 'r' }}
                onAction={() => {
                  cache.remove(CACHE_KEY);
                  cache.remove(CACHE_EXPIRY_KEY);
                  window.location.reload();
                }}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
