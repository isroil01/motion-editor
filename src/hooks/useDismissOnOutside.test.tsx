import { render, fireEvent, act } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useDismissOnOutside } from './useDismissOnOutside';

function Harness(): JSX.Element {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useDismissOnOutside(open, [btn, pop], () => setOpen(false));
  return (
    <div>
      <button ref={btn} data-testid="trigger" onClick={() => setOpen((v) => !v)}>t</button>
      {open && <div ref={pop} data-testid="pop"><button data-testid="inner">i</button></div>}
      <div data-testid="elsewhere" onPointerDown={(e) => e.stopPropagation()}>x</div>
    </div>
  );
}

describe('useDismissOnOutside', () => {
  it('closes on a pointerdown outside the popup and trigger, even when propagation is stopped', () => {
    const { getByTestId, queryByTestId } = render(<Harness />);
    fireEvent.click(getByTestId('trigger'));
    expect(queryByTestId('pop')).not.toBeNull();
    fireEvent.pointerDown(getByTestId('elsewhere'));
    expect(queryByTestId('pop')).toBeNull();
  });

  it('stays open for clicks inside the popup, and the trigger still toggles', () => {
    const { getByTestId, queryByTestId } = render(<Harness />);
    fireEvent.click(getByTestId('trigger'));
    fireEvent.pointerDown(getByTestId('inner'));
    expect(queryByTestId('pop')).not.toBeNull();
    act(() => {
      fireEvent.pointerDown(getByTestId('trigger'));
      fireEvent.click(getByTestId('trigger'));
    });
    expect(queryByTestId('pop')).toBeNull();
  });

  it('closes on Escape', () => {
    const { getByTestId, queryByTestId } = render(<Harness />);
    fireEvent.click(getByTestId('trigger'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(queryByTestId('pop')).toBeNull();
  });
});
