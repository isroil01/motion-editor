import { render, screen } from '@testing-library/react';
import { DialogFooter } from './DialogFooter';

describe('DialogFooter', () => {
  it('keeps secondary and destructive on the left and the primary alone on the right', () => {
    const { container } = render(
      <DialogFooter
        secondary={<button type="button">Cancel</button>}
        destructive={<button type="button">Delete</button>}
        primary={<button type="button">Save</button>}
      />,
    );
    const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).toEqual(['Cancel', 'Delete', 'Save']);

    const root = container.firstElementChild!;
    const [start, end] = [...root.children];
    expect(start).toContainElement(screen.getByText('Cancel'));
    expect(start).toContainElement(screen.getByText('Delete'));
    expect(end).toContainElement(screen.getByText('Save'));
    // The primary is never adjacent to the destructive verb.
    expect(end!.querySelectorAll('button')).toHaveLength(1);
  });

  it('renders a note beside the left-hand actions', () => {
    render(<DialogFooter note="Unsaved changes" primary={<button type="button">Save</button>} />);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });
});
