import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { TitleBar } from './TitleBar';
import { usePresentationStore } from '@stores/presentationStore';
import * as exportDialogModule from '@layout/Export/ExportDialog';

jest.mock('@layout/Export/ExportDialog', () => ({
  openExportDialog: jest.fn(),
}));

const renderTitleBar = () =>
  render(
    <TooltipProvider>
      <MemoryRouter initialEntries={['/editor']}>
        <TitleBar />
      </MemoryRouter>
    </TooltipProvider>
  );

describe('TitleBar Preview and Export buttons', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (window as unknown as { electronAPI: unknown }).electronAPI = {};
  });

  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('renders Preview and Export with standard Button sizes and variants on editor route', () => {
    renderTitleBar();

    const previewBtn = screen.getByRole('button', { name: /Preview/i });
    const exportBtn = screen.getByRole('button', { name: /Export/i });

    expect(previewBtn).toBeInTheDocument();
    expect(exportBtn).toBeInTheDocument();

    expect(previewBtn).toHaveAttribute('data-size', 'sm');
    expect(exportBtn).toHaveAttribute('data-size', 'sm');

    expect(previewBtn).toHaveAttribute('data-variant', 'secondary');
    expect(exportBtn).toHaveAttribute('data-variant', 'primary');
  });

  it('triggers enterPresentation and openExportDialog on click', () => {
    const enterSpy = jest.fn();
    usePresentationStore.setState({ enter: enterSpy });

    renderTitleBar();

    fireEvent.click(screen.getByRole('button', { name: /Preview/i }));
    expect(enterSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Export/i }));
    expect(exportDialogModule.openExportDialog).toHaveBeenCalledTimes(1);
  });
});
