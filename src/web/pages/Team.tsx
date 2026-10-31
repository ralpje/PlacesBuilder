import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import type { WorkspaceInfo } from '../../shared/types.ts';

export function TeamPage({ myId }: { myId: string }) {
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => api.workspace().then(setInfo).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setErr(''); setMsg('');
    try { await fn(); setMsg(done); await load(); } catch (e) { setErr((e as Error).message); }
  };
  const invite = async () => {
    const value = email.trim();
    if (!value) return;
    await run(() => api.invite(value), `Invitation saved for ${value}. They can sign in now.`);
    setEmail('');
  };

  if (!info) return <p className="muted">{err || 'Loading…'}</p>;
  const owner = info.role === 'owner';
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Your organization</h1>
          <p>Everyone here works on the same offices. {owner ? 'You are the owner and decide who joins.' : 'The owner decides who joins.'}</p>
        </div>
      </div>
      {err && <p className="error">{err}</p>}
      {msg && <p className="ok">{msg}</p>}

      {owner && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 style={{ marginTop: 0 }}>Invite a colleague</h2>
          <p className="muted">
            Enter the address the person signs in with (their work account). They must be in your organization. When they open Places Builder and sign in,
            they join automatically. All members have the same rights; only you can invite or remove people. At most {info.limit} members and open invitations.
          </p>
          <div className="row">
            <input type="email" placeholder="name@yourcompany.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && invite()} style={{ minWidth: 280 }} />
            <button className="primary" onClick={invite}>Invite</button>
          </div>
        </div>
      )}

      <h2>Members</h2>
      <table>
        <thead><tr><th>Name</th><th>Sign-in address</th><th>Role</th><th>Joined</th>{owner && <th />}</tr></thead>
        <tbody>
          {info.members.map((m) => (
            <tr key={m.oid}>
              <td>{m.name}{m.oid === myId && <span className="muted"> (you)</span>}</td>
              <td>{m.email}</td>
              <td>{m.role === 'owner' ? <span className="pill">Owner</span> : 'Member'}</td>
              <td>{new Date(m.joinedAt).toLocaleDateString()}</td>
              {owner && (
                <td>
                  {m.oid !== myId && (
                    <button className="danger" onClick={() => confirm(`Remove ${m.name}? They lose access straight away. Their work stays.`) && run(() => api.removeMember(m.oid), `${m.name} was removed.`)}>Remove</button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {owner && info.invites.length > 0 && (
        <>
          <h2>Open invitations</h2>
          <table>
            <thead><tr><th>Address</th><th>Invited</th><th /></tr></thead>
            <tbody>
              {info.invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>{new Date(i.createdAt).toLocaleDateString()}</td>
                  <td><button onClick={() => run(() => api.revokeInvite(i.id), `Invitation for ${i.email} withdrawn.`)}>Withdraw</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
