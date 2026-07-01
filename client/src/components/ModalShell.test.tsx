import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import ModalShell from './ModalShell';

describe('ModalShell', () => {
  it('exposes dialog semantics and closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <ModalShell labelledBy="modal-title" onClose={onClose}>
        <h2 id="modal-title">Проверка</h2>
        <button type="button">Действие</button>
      </ModalShell>
    );

    expect(screen.getByRole('dialog', { name: 'Проверка' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the opener after unmount', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Открыть</button>
          {open && (
            <ModalShell labelledBy="modal-title" onClose={() => setOpen(false)}>
              <h2 id="modal-title">Модалка</h2>
              <button type="button" onClick={() => setOpen(false)}>Закрыть</button>
            </ModalShell>
          )}
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Открыть' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(opener).toHaveFocus();
  });
});
