import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { TopNav } from './TopNav';
import { usePresentationStore } from '@stores/presentationStore';
import * as exportDialogModule from '@layout/Export/ExportDialog';
import { CommandSystem, setCommandSystem } from '@core/commands/CommandSystem';

jest.mock('@layout/Export/ExportDialog', () => ({
  openExportDialog: jest.fn(),
}));

const renderTopNav = () =>
  render(
    <TooltipProvider>
      <MemoryRouter>
        <TopNav />
      </MemoryRouter>
    </TooltipProvider>
  );

describe('TopNav Preview and Export buttons', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setCommandSystem(new CommandSystem({ services: {} as never, getState: () => ({}) as never }));
  });

  it('renders Preview and Export with standard Button sizes and variants', () => {
    renderTopNav();

    const previewBtn = screen.getByRole('button', { name: /Preview/i });
    const exportBtn = screen.getByRole('button', { name: /Export/i });

    expect(previewBtn).toBeInTheDocument();
    expect(exportBtn).toBeInTheDocument();

    // Size check: both must be size="sm" to match the row's other buttons
    expect(previewBtn).toHaveAttribute('data-size', 'sm');
    expect(exportBtn).toHaveAttribute('data-size', 'sm');

    // Variant check: Export is primary, Preview is secondary
    expect(previewBtn).toHaveAttribute('data-variant', 'secondary');
    expect(exportBtn).toHaveAttribute('data-variant', 'primary');

    // Export retains tour target
    expect(exportBtn).toHaveAttribute('data-tour', 'export');
  });

  it('triggers enterPresentation when Preview button is clicked', () => {
    const enterSpy = jest.fn();
    usePresentationStore.setState({ enter: enterSpy });

    renderTopNav();

    const previewBtn = screen.getByRole('button', { name: /Preview/i });
    fireEvent.click(previewBtn);

    expect(enterSpy).toHaveBeenCalledTimes(1);
  });

  it('triggers openExportDialog when Export button is clicked', () => {
    renderTopNav();

    const exportBtn = screen.getByRole('button', { name: /Export/i });
    fireEvent.click(exportBtn);

    expect(exportDialogModule.openExportDialog).toHaveBeenCalledTimes(1);
  });
});
