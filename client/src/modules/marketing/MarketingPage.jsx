import { useState, useEffect } from 'react';

export function MarketingPage() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState('');
  const [previewData, setPreviewData] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [activeTab, setActiveTab] = useState('campaigns');

  useEffect(() => {
    fetchCampaigns();
  }, []);

  async function fetchCampaigns() {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/marketing/campaigns', { credentials: 'include' });
      const data = await res.json();
      if (data.status === 'success') {
        setCampaigns(data.data);
      }
    } catch (err) {
      console.error('Error fetching campaigns:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateCampaign(e) {
    e.preventDefault();
    if (!newCampaignName.trim()) return;
    try {
      const res = await fetch('/api/v1/marketing/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newCampaignName.trim() }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setNewCampaignName('');
        fetchCampaigns();
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handlePreviewCsv(e) {
    e.preventDefault();
    if (!selectedFile) return;

    const formData = new FormData();
    formData.append('file', selectedFile);

    setUploadStatus('Analyzing CSV (Dry-Run Preview)...');
    try {
      const res = await fetch('/api/v1/marketing/leads/preview', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const data = await res.json();
      if (data.status === 'success') {
        setPreviewData(data.data);
        setUploadStatus('');
      } else {
        setUploadStatus(data.error || 'Failed to parse CSV');
      }
    } catch (err) {
      setUploadStatus(err.message);
    }
  }

  async function handleImportValidLeads(campaignId) {
    if (!previewData || !previewData.validLeads.length) return;
    setUploadStatus('Importing validated leads...');
    try {
      const res = await fetch('/api/v1/marketing/leads/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          campaignId: Number(campaignId),
          leads: previewData.validLeads,
        }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setUploadStatus(`🎉 Successfully imported ${data.data.insertedCount} leads into campaign #${campaignId}!`);
        setPreviewData(null);
        setSelectedFile(null);
        fetchCampaigns();
      } else {
        setUploadStatus(data.error || 'Import failed');
      }
    } catch (err) {
      setUploadStatus(err.message);
    }
  }

  async function handleTriggerOutreach(campaignId) {
    if (!window.confirm('Trigger anti-ban WhatsApp outreach to idle leads in this campaign?')) return;
    try {
      const res = await fetch(`/api/v1/marketing/campaigns/${campaignId}/outreach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ jitterMinSeconds: 12, jitterMaxSeconds: 28 }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        alert(`✅ Enqueued ${data.data.scheduledCount} messages with anti-ban jitter into outbox!`);
        fetchCampaigns();
      }
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid #334155', paddingBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 4px 0', color: '#f8fafc' }}>
            Module 2: Marketing & Lead Outreach
          </h1>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: '14px' }}>
            Two-stage bulk lead ingestion, anti-ban WhatsApp dispatch, and automated conversational qualification.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setActiveTab('campaigns')}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: 'none',
              background: activeTab === 'campaigns' ? '#2563eb' : '#1e293b',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            📊 Campaigns
          </button>
          <button
            onClick={() => setActiveTab('csv')}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: 'none',
              background: activeTab === 'csv' ? '#2563eb' : '#1e293b',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            📥 CSV Ingestion (Dry-Run)
          </button>
        </div>
      </div>

      {activeTab === 'campaigns' && (
        <div>
          {/* Create Campaign */}
          <div style={{ background: '#1e293b', padding: '20px', borderRadius: '8px', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: '600', color: '#f8fafc', marginTop: 0 }}>Create New Campaign</h2>
            <form onSubmit={handleCreateCampaign} style={{ display: 'flex', gap: '12px' }}>
              <input
                type="text"
                placeholder="e.g. Fall 2026 Pre-Engineering Drive"
                value={newCampaignName}
                onChange={(e) => setNewCampaignName(e.target.value)}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: '6px',
                  background: '#0f172a',
                  border: '1px solid #334155',
                  color: '#fff',
                }}
              />
              <button
                type="submit"
                style={{
                  padding: '10px 20px',
                  background: '#16a34a',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                + Create Campaign
              </button>
            </form>
          </div>

          {/* Campaign List */}
          <div style={{ background: '#1e293b', padding: '20px', borderRadius: '8px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: '600', color: '#f8fafc', marginTop: 0 }}>Active Campaigns</h2>
            {loading ? (
              <p style={{ color: '#94a3b8' }}>Loading campaigns...</p>
            ) : campaigns.length === 0 ? (
              <p style={{ color: '#94a3b8' }}>No campaigns created yet. Create one above to start outreach.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', color: '#f8fafc', fontSize: '14px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #334155', textAlign: 'left', color: '#94a3b8' }}>
                    <th style={{ padding: '10px' }}>ID</th>
                    <th style={{ padding: '10px' }}>Name</th>
                    <th style={{ padding: '10px' }}>Status</th>
                    <th style={{ padding: '10px' }}>Total Leads</th>
                    <th style={{ padding: '10px' }}>Sent</th>
                    <th style={{ padding: '10px' }}>Eligible / Qualified</th>
                    <th style={{ padding: '10px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id} style={{ borderBottom: '1px solid #334155' }}>
                      <td style={{ padding: '12px 10px' }}>#{c.id}</td>
                      <td style={{ padding: '12px 10px', fontWeight: '600' }}>{c.name}</td>
                      <td style={{ padding: '12px 10px' }}>
                        <span style={{
                          padding: '3px 8px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          background: c.status === 'ACTIVE' ? '#065f46' : '#374151',
                          color: c.status === 'ACTIVE' ? '#34d399' : '#d1d5db',
                        }}>
                          {c.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px 10px' }}>{c.totalLeads}</td>
                      <td style={{ padding: '12px 10px' }}>{c.sentCount}</td>
                      <td style={{ padding: '12px 10px', color: '#38bdf8', fontWeight: '600' }}>{c.eligibleCount}</td>
                      <td style={{ padding: '12px 10px' }}>
                        <button
                          onClick={() => handleTriggerOutreach(c.id)}
                          style={{
                            padding: '6px 12px',
                            background: '#0284c7',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: 600,
                          }}
                        >
                          🚀 Send Outreach
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'csv' && (
        <div style={{ background: '#1e293b', padding: '20px', borderRadius: '8px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: '600', color: '#f8fafc', marginTop: 0 }}>
            Two-Stage Bulk Lead Ingestion (Dry-Run & Commit)
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '16px' }}>
            Upload a CSV containing applicant leads. The parser stream-checks phone normalization (E.164) and flags duplicate records before committing anything to MySQL.
          </p>

          <form onSubmit={handlePreviewCsv} style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px' }}>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setSelectedFile(e.target.files[0])}
              style={{ color: '#fff' }}
            />
            <button
              type="submit"
              disabled={!selectedFile}
              style={{
                padding: '10px 20px',
                background: selectedFile ? '#2563eb' : '#475569',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: selectedFile ? 'pointer' : 'not-allowed',
                fontWeight: 600,
              }}
            >
              🔍 Run Dry-Run Preview
            </button>
          </form>

          {uploadStatus && (
            <div style={{ padding: '12px', borderRadius: '6px', background: '#0f172a', color: '#38bdf8', marginBottom: '16px' }}>
              {uploadStatus}
            </div>
          )}

          {previewData && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '20px' }}>
                <div style={{ background: '#0f172a', padding: '16px', borderRadius: '6px' }}>
                  <div style={{ color: '#94a3b8', fontSize: '12px' }}>Total Rows</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#f8fafc' }}>{previewData.totalRows}</div>
                </div>
                <div style={{ background: '#0f172a', padding: '16px', borderRadius: '6px' }}>
                  <div style={{ color: '#94a3b8', fontSize: '12px' }}>Valid New Leads</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#4ade80' }}>{previewData.validCount}</div>
                </div>
                <div style={{ background: '#0f172a', padding: '16px', borderRadius: '6px' }}>
                  <div style={{ color: '#94a3b8', fontSize: '12px' }}>Duplicates Found</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#fbbf24' }}>{previewData.duplicateCount}</div>
                </div>
                <div style={{ background: '#0f172a', padding: '16px', borderRadius: '6px' }}>
                  <div style={{ color: '#94a3b8', fontSize: '12px' }}>Invalid Phones</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#f87171' }}>{previewData.invalidPhoneCount}</div>
                </div>
              </div>

              <h3 style={{ fontSize: '14px', color: '#f8fafc', marginBottom: '8px' }}>Preview Sample (First 10 Rows):</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', color: '#f8fafc', fontSize: '13px', marginBottom: '20px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #334155', textAlign: 'left', color: '#94a3b8' }}>
                    <th style={{ padding: '8px' }}>Name</th>
                    <th style={{ padding: '8px' }}>Raw Phone</th>
                    <th style={{ padding: '8px' }}>Normalized Phone (E.164)</th>
                    <th style={{ padding: '8px' }}>City</th>
                    <th style={{ padding: '8px' }}>Validation Status</th>
                  </tr>
                </thead>
                <tbody>
                  {previewData.previewRows.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #334155' }}>
                      <td style={{ padding: '8px' }}>{r.fullName}</td>
                      <td style={{ padding: '8px' }}>{r.phoneRaw}</td>
                      <td style={{ padding: '8px', color: '#38bdf8' }}>{r.phoneNormalized || '—'}</td>
                      <td style={{ padding: '8px' }}>{r.city || '—'}</td>
                      <td style={{ padding: '8px' }}>
                        <span style={{
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          background: r.status === 'VALID' ? '#065f46' : '#7f1d1d',
                          color: r.status === 'VALID' ? '#34d399' : '#fca5a5',
                        }}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {campaigns.length > 0 && previewData.validCount > 0 && (
                <div style={{ background: '#0f172a', padding: '16px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <span style={{ color: '#f8fafc', fontWeight: 600 }}>Commit valid leads to campaign:</span>
                  <select
                    id="commit-campaign-select"
                    style={{
                      padding: '8px 12px',
                      borderRadius: '6px',
                      background: '#1e293b',
                      color: '#fff',
                      border: '1px solid #334155',
                    }}
                  >
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        #{c.id} - {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      const select = document.getElementById('commit-campaign-select');
                      handleImportValidLeads(select.value);
                    }}
                    style={{
                      padding: '8px 16px',
                      background: '#16a34a',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    💾 Confirm & Commit {previewData.validCount} Leads
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
