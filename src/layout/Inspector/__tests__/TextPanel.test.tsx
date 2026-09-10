import { render, screen, fireEvent, act } from '@testing-library/react';
import { CharacterPanel } from '../CharacterPanel';
import { ParagraphPanel } from '../ParagraphPanel';
import { TooltipProvider } from '@components/Tooltip';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { useSelectionStore } from '@stores/selectionStore';
import { PANEL_DEFS, availablePanelDefs, panelDef } from '@layout/EditorLayout/panelDefs';
import { PANEL_COMPONENTS } from '@layout/EditorLayout/panelRenderers';
import type { SceneNode } from '@core/types';

function buildTextNode(id: string, name: string, textProps: Record<string, unknown> = {}): SceneNode {
  return {
    id,
    name,
    parent: null,
    children: [],
    visible: true,
    locked: false,
    transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    components: [
      { id: `${id}_t`, type: 'Transform', props: { x: 0, y: 0, width: 200, height: 60, opacity: 100 } },
      { id: `${id}_txt`, type: 'Text', props: textProps },
    ],
  } as unknown as SceneNode;
}

function renderPanel() {
  return render(
    <TooltipProvider>
      <CharacterPanel />
    </TooltipProvider>,
  );
}

describe('Unified Text Panel (Character + Paragraph)', () => {
  const createdNodeIds: string[] = [];

  const addTextNode = (id: string, name: string, textProps: Record<string, unknown> = {}) => {
    const node = buildTextNode(id, name, textProps);
    defaultSceneGraph.addNode(node);
    createdNodeIds.push(id);
    return node;
  };

  afterEach(() => {
    for (const id of createdNodeIds) {
      if (defaultSceneGraph.getNode(id)) defaultSceneGraph.removeNode(id);
    }
    createdNodeIds.length = 0;
    useSelectionStore.setState({ ids: [] });
  });

  it('renders default text panel when no text node is selected', () => {
    renderPanel();
    expect(screen.getByText('Text')).toBeInTheDocument();
    expect(screen.getByText('Default Preset')).toBeInTheDocument();
    expect(screen.getByText('Typography')).toBeInTheDocument();
    expect(screen.getByText(/Paragraph/)).toBeInTheDocument();
  });

  it('renders both character and paragraph controls for selected text layer', () => {
    const textNode = addTextNode('test_headline', 'Headline Layer', {
      content: 'Hello World',
      fontSize: 48,
      fontFamily: 'Inter',
      fontWeight: '600',
      align: 'left',
      paragraphSpacing: 12,
      lineHeight: 1.3,
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: 0,
    });

    useSelectionStore.setState({ ids: [textNode.id] });
    renderPanel();

    // Verify layer name in header badge
    expect(screen.getByText('Headline Layer')).toBeInTheDocument();

    // Verify content textarea
    const textarea = screen.getByPlaceholderText('Type text content here...') as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.value).toBe('Hello World');

    // Verify typography controls
    expect(screen.getByLabelText('Font Size')).toHaveValue(48);
    expect(screen.getByLabelText('Leading (Line Height)')).toHaveValue(1.3);

    // Verify character style buttons
    expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Italic' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All Caps' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Small Caps' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Superscript' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Subscript' })).toBeInTheDocument();

    // Verify all 7 alignment buttons
    expect(screen.getByRole('button', { name: 'Left Align' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Center Align' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Right Align' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Justify Last Left' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Justify Last Center' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Justify Last Right' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Justify All Lines' })).toBeInTheDocument();

    // Verify paragraph metrics
    expect(screen.getByLabelText('Paragraph Spacing')).toHaveValue(12);
    expect(screen.getByLabelText('First Line Indent')).toBeInTheDocument();
    expect(screen.getByLabelText('Left Indent')).toBeInTheDocument();
    expect(screen.getByLabelText('Right Indent')).toBeInTheDocument();
    expect(screen.getByLabelText('Space Before')).toBeInTheDocument();
  });

  it('updates alignment when paragraph alignment buttons are clicked', () => {
    const textNode = addTextNode('test_body', 'Body Copy', {
      content: 'Paragraph content',
      fontSize: 24,
      align: 'left',
    });

    act(() => {
      useSelectionStore.setState({ ids: [textNode.id] });
    });
    renderPanel();

    const centerBtn = screen.getByRole('button', { name: 'Center Align' });
    act(() => {
      fireEvent.click(centerBtn);
    });

    const comp1 = defaultSceneGraph.getNode(textNode.id)?.components.find((c) => c.type === 'Text');
    expect(comp1?.props.align).toBe('center');

    const rightBtn = screen.getByRole('button', { name: 'Right Align' });
    act(() => {
      fireEvent.click(rightBtn);
    });
    const comp2 = defaultSceneGraph.getNode(textNode.id)?.components.find((c) => c.type === 'Text');
    expect(comp2?.props.align).toBe('right');
  });

  it('updates paragraph spacing when input changes', () => {
    const textNode = addTextNode('test_spaced', 'Spaced Copy', {
      content: 'Spaced paragraph',
      paragraphSpacing: 10,
    });

    act(() => {
      useSelectionStore.setState({ ids: [textNode.id] });
    });
    renderPanel();

    const spacingInput = screen.getByLabelText('Paragraph Spacing');
    act(() => {
      fireEvent.change(spacingInput, { target: { value: '25' } });
    });

    const comp = defaultSceneGraph.getNode(textNode.id)?.components.find((c) => c.type === 'Text');
    expect(comp?.props.paragraphSpacing).toBe(25);
  });

  it('ParagraphPanel exports the unified component for backward compatibility', () => {
    expect(ParagraphPanel).toBe(CharacterPanel);
  });

  describe('Panel Registry Consolidation', () => {
    it('character panel is titled "Text" with icon "type"', () => {
      const def = panelDef('character');
      expect(def).toBeDefined();
      expect(def?.title).toBe('Text');
      expect(def?.icon).toBe('type');
      expect(def?.region).toBe('rightInspector');
    });

    it('separate paragraph panel is removed from PANEL_DEFS to avoid duplicate tabs', () => {
      const paragraphDef = PANEL_DEFS.find((p) => p.id === 'paragraph');
      expect(paragraphDef).toBeUndefined();

      const availableIds = availablePanelDefs().map((p) => p.id);
      expect(availableIds).toContain('character');
      expect(availableIds).not.toContain('paragraph');
    });

    it('PANEL_COMPONENTS maps both character and paragraph to CharacterPanel', () => {
      expect(PANEL_COMPONENTS.character).toBe(CharacterPanel);
      expect(PANEL_COMPONENTS.paragraph).toBe(CharacterPanel);
    });
  });
});
