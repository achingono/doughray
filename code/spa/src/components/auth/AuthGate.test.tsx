import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from './AuthGate';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('AuthGate', () => {
  it('signs in after an expired session and returns to login on expiry', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: { message: 'Login required' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { authenticated: true } }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<AuthGate><p>Private dashboard</p></AuthGate>);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Owner password'), 'test-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Private dashboard')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST', body: JSON.stringify({ password: 'test-password' }) }));
    window.dispatchEvent(new Event('doughray:session-expired'));
    await waitFor(() => expect(screen.getByLabelText('Owner password')).toBeInTheDocument());
  });
});
