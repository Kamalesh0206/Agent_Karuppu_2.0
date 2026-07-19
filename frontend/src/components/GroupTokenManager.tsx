import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config.ts';
import { Key, CheckCircle2, XCircle, RefreshCw, AlertTriangle, ShieldCheck, ListChecks, HelpCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Account {
  id: number;
  instagram_username: string;
  facebook_page_name: string | null;
  facebook_page_id: string | null;
  status: string;
  token_expiry: string | null;
}

interface GroupTokenManagerProps {
  groupId: number;
  accounts: Account[];
  onRefresh: () => void;
}

interface ValidationResult {
  valid: boolean;
  expiry_date: string;
  available_pages: Array<{ id: string; name: string }>;
  connected_instagram_accounts: Array<{ username: string; id: string }>;
  missing_permissions: string[];
}

interface UpdateSummary {
  total: number;
  updated: number;
  failed: number;
  skipped: number;
  failed_details: Array<{ username: string; reason: string }>;
}

export default function GroupTokenManager({ groupId, accounts, onRefresh }: GroupTokenManagerProps) {
  const [newToken, setNewToken] = useState('');
  const [updateMode, setUpdateMode] = useState<'all' | 'selected'>('all');
  const [selectedAccIds, setSelectedAccIds] = useState<number[]>([]);
  
  // Validation state
  const [isValidating, setIsValidating] = useState(false);
  const [validationRes, setValidationRes] = useState<ValidationResult | null>(null);
  const [validationErr, setValidationErr] = useState('');
  const [isValidated, setIsValidated] = useState(false);

  // Update execution state
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateSummary, setUpdateSummary] = useState<UpdateSummary | null>(null);
  const [updateError, setUpdateError] = useState('');

  // Reset states when group changes
  useEffect(() => {
    setNewToken('');
    setUpdateMode('all');
    setSelectedAccIds([]);
    setValidationRes(null);
    setValidationErr('');
    setIsValidated(false);
    setUpdateSummary(null);
    setUpdateError('');
  }, [groupId]);

  // Compute token stats for the group
  const hasExpired = accounts.some(acc => acc.status !== 'Connected');
  const activeCount = accounts.filter(acc => acc.status === 'Connected').length;
  
  // Format dates securely
  const getLatestExpiryDate = () => {
    const dates = accounts
      .map(acc => acc.token_expiry)
      .filter(Boolean)
      .map(d => new Date(d!));
    if (dates.length === 0) return 'N/A';
    const earliest = new Date(Math.min(...dates.map(d => d.getTime())));
    const diffTime = earliest.getTime() - new Date().getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const formatted = earliest.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    if (diffDays <= 0) {
      return `${formatted} (Expired)`;
    }
    return `${formatted} (${diffDays} days left)`;
  };

  const getAccountExpirySummary = (expiry: string | null) => {
    if (!expiry) return 'N/A';
    const d = new Date(expiry);
    const diffTime = d.getTime() - new Date().getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const formatted = d.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    if (diffDays <= 0) {
      return `${formatted} (Expired)`;
    }
    return `${formatted} (${diffDays} days left)`;
  };

  const handleSelectAll = () => {
    setSelectedAccIds(accounts.map(acc => acc.id));
  };

  const handleClearSelection = () => {
    setSelectedAccIds([]);
  };

  const toggleSelectAccount = (id: number) => {
    if (selectedAccIds.includes(id)) {
      setSelectedAccIds(selectedAccIds.filter(x => x !== id));
    } else {
      setSelectedAccIds([...selectedAccIds, id]);
    }
  };

  const handleValidateToken = async () => {
    const tokenStr = newToken.trim();
    if (!tokenStr) {
      setValidationErr('Please enter an access token to validate.');
      return;
    }
    setIsValidating(true);
    setValidationErr('');
    setValidationRes(null);
    setIsValidated(false);
    
    try {
      const response = await axios.post(`${API_URL}/groups/${groupId}/validate-token`, {
        access_token: tokenStr
      }, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setValidationRes(response.data);
      setIsValidated(response.data.valid);
    } catch (err: any) {
      setValidationErr(err.response?.data?.detail || 'Token validation failed. Please verify token parameters.');
    } finally {
      setIsValidating(false);
    }
  };

  const handleUpdateToken = async () => {
    const tokenStr = newToken.trim();
    if (!tokenStr) return;
    setIsUpdating(true);
    setUpdateError('');
    setUpdateSummary(null);

    try {
      const payload = {
        access_token: tokenStr,
        validate_token: false, // already validated in UI
        account_ids: updateMode === 'selected' ? selectedAccIds : null
      };

      const response = await axios.post(
        `${API_URL}/groups/${groupId}/update-token`,
        payload,
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
        }
      );
      
      setUpdateSummary(response.data);
      setNewToken('');
      setValidationRes(null);
      setIsValidated(false);
      onRefresh(); // auto refresh accounts parent list
    } catch (err: any) {
      setUpdateError(err.response?.data?.detail || 'Failed to update access tokens.');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* 1. Current Token Status Card */}
      <div className="glass-panel p-5 rounded-2xl border border-slate-900 bg-slate-950/20 space-y-4">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Current Token Status</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-semibold">
          <div>
            <span className="block text-slate-500 text-[10px] uppercase mb-0.5">Status</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold inline-block ${
              accounts.length === 0 
                ? "bg-slate-900 text-slate-400 border border-slate-800" 
                : hasExpired 
                  ? "bg-red-500/10 text-red-400 border border-red-500/20" 
                  : "bg-green-500/10 text-green-400 border border-green-500/20"
            }`}>
              {accounts.length === 0 ? "No Accounts" : hasExpired ? "Action Required" : "All Active"}
            </span>
          </div>
          <div>
            <span className="block text-slate-500 text-[10px] uppercase mb-0.5">Connected Accounts</span>
            <span className="text-slate-300 font-mono text-sm">{accounts.length} ({activeCount} active)</span>
          </div>
          <div>
            <span className="block text-slate-500 text-[10px] uppercase mb-0.5">Group Expiry Date</span>
            <span className="text-slate-300 font-mono text-sm">{getLatestExpiryDate()}</span>
          </div>
          <div>
            <span className="block text-slate-500 text-[10px] uppercase mb-0.5">Last Checked</span>
            <span className="text-slate-300 font-mono text-sm">Today</span>
          </div>
        </div>
      </div>

      {/* 2. New Token Input Form */}
      <div className="glass-panel p-5 rounded-2xl border border-slate-900 shadow-xl space-y-4">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Update Token Screen</h4>
        
        {/* Token Area */}
        <div className="space-y-2">
          <label className="block text-xs text-slate-500">New Access Token</label>
          <textarea
            rows={2}
            value={newToken}
            onChange={(e) => {
              setNewToken(e.target.value);
              setIsValidated(false);
              setValidationRes(null);
            }}
            placeholder="Paste group Facebook Page Access Token or User Access Token here..."
            className="w-full px-4 py-3 rounded-xl bg-slate-900/50 border border-slate-800 focus:border-purple-500/50 outline-none text-slate-200 text-xs font-mono transition-all placeholder:text-slate-700"
          />
        </div>

        {/* Mode Checkbox Options */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Target Scope</label>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="radio"
                name="updateMode"
                checked={updateMode === 'all'}
                onChange={() => setUpdateMode('all')}
                className="accent-purple-500 cursor-pointer"
              />
              <span>Update all connected accounts in this group</span>
            </label>
            <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="radio"
                name="updateMode"
                checked={updateMode === 'selected'}
                onChange={() => setUpdateMode('selected')}
                className="accent-purple-500 cursor-pointer"
              />
              <span>Update only selected accounts</span>
            </label>
          </div>
        </div>

        {/* Selected Accounts checklist table */}
        <AnimatePresence>
          {updateMode === 'selected' && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-3 pt-2 overflow-hidden"
            >
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-[10px] font-bold border border-slate-800 transition-all cursor-pointer"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-[10px] font-bold border border-slate-800 transition-all cursor-pointer"
                >
                  Clear Selection
                </button>
              </div>

              {/* Table */}
              <div className="border border-slate-900 rounded-xl overflow-hidden text-xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-900/60 border-b border-slate-900 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                      <th className="p-3 w-12 text-center">Select</th>
                      <th className="p-3">Instagram Username</th>
                      <th className="p-3">Facebook Page</th>
                      <th className="p-3">Expiry Date</th>
                      <th className="p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-4 text-center text-slate-600 font-medium">No profiles connected in this group.</td>
                      </tr>
                    ) : (
                      accounts.map(acc => (
                        <tr key={acc.id} className="border-b border-slate-900 hover:bg-slate-900/20 text-slate-300">
                          <td className="p-3 text-center">
                            <input
                              type="checkbox"
                              checked={selectedAccIds.includes(acc.id)}
                              onChange={() => toggleSelectAccount(acc.id)}
                              className="accent-purple-500 cursor-pointer"
                            />
                          </td>
                          <td className="p-3 font-bold">@{acc.instagram_username}</td>
                          <td className="p-3 text-slate-500 font-medium">{acc.facebook_page_name || 'N/A'}</td>
                          <td className="p-3 font-mono text-[10px] text-purple-400">{getAccountExpirySummary(acc.token_expiry)}</td>
                          <td className="p-3">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                              acc.status === 'Connected' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                            }`}>
                              {acc.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Workflow actions */}
        <div className="flex items-center gap-3 pt-3">
          <button
            type="button"
            onClick={handleValidateToken}
            disabled={isValidating || !newToken}
            className="flex items-center gap-1.5 px-4 py-2 border border-slate-800 hover:bg-slate-900 hover:border-slate-700 text-slate-300 font-bold rounded-xl text-xs transition-all cursor-pointer disabled:opacity-50"
          >
            {isValidating ? <RefreshCw size={12} className="animate-spin" /> : <Key size={12} />}
            <span>Validate Token</span>
          </button>
          
          <button
            type="button"
            onClick={handleUpdateToken}
            disabled={isUpdating || !isValidated || (updateMode === 'selected' && selectedAccIds.length === 0)}
            className="flex items-center gap-1.5 px-5 py-2 gradient-btn text-slate-950 font-black rounded-xl text-xs hover:shadow-lg transition-all cursor-pointer disabled:opacity-50"
          >
            {isUpdating ? <RefreshCw size={12} className="animate-spin" /> : null}
            <span>Update Token</span>
          </button>
        </div>

        {/* Error message */}
        {validationErr && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold rounded-xl flex items-center gap-2">
            <AlertTriangle size={14} />
            <span>{validationErr}</span>
          </div>
        )}
        {updateError && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold rounded-xl flex items-center gap-2">
            <AlertTriangle size={14} />
            <span>{updateError}</span>
          </div>
        )}
      </div>

      {/* 3. Validation results display banner */}
      <AnimatePresence>
        {validationRes && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="glass-panel p-5 rounded-2xl border border-slate-900 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-900 pb-2">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Validation Details</h4>
              <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                validationRes.valid ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
              }`}>
                {validationRes.valid ? 'Token Valid' : 'Token Invalid'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-semibold">
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Expiry Date:</span>
                  <span className="text-slate-300 font-mono">{validationRes.expiry_date}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Available Pages:</span>
                  <span className="text-slate-300">{validationRes.available_pages.length} pages</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Connected Accounts:</span>
                  <span className="text-purple-400">{validationRes.connected_instagram_accounts.length} profiles</span>
                </div>
              </div>

              {/* Missing Permissions list */}
              <div>
                <span className="block text-slate-500 text-[10px] uppercase mb-1">Missing Permissions</span>
                {validationRes.missing_permissions.length === 0 ? (
                  <span className="text-green-400 flex items-center gap-1">
                    <ShieldCheck size={12} />
                    <span>All Permissions Granted</span>
                  </span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {validationRes.missing_permissions.map(perm => (
                      <span key={perm} className="px-1.5 py-0.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded text-[9px] font-mono">
                        {perm}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* List of matched profiles */}
            <div className="space-y-2">
              <span className="block text-slate-500 text-[10px] uppercase">Matched Profiles</span>
              <div className="flex flex-wrap gap-2">
                {validationRes.connected_instagram_accounts.map(acc => {
                  const alreadyExists = accounts.some(a => a.instagram_username.toLowerCase() === acc.username.toLowerCase());
                  return (
                    <span key={acc.id} className={`px-2 py-1 rounded-lg border text-[10px] font-bold ${
                      alreadyExists 
                        ? 'bg-purple-500/15 border-purple-500/30 text-purple-400' 
                        : 'bg-slate-900 border-slate-800 text-slate-500'
                    }`} title={alreadyExists ? "Profile in this group" : "Not connected in this group"}>
                      @{acc.username}
                    </span>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 4. Update Summary box */}
      <AnimatePresence>
        {updateSummary && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            className="glass-panel p-5 rounded-2xl border border-slate-900 bg-slate-950 space-y-4"
          >
            <div className="border-b border-slate-900 pb-2 flex justify-between items-center">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Update Summary</h4>
              <span className="text-[10px] text-green-400 flex items-center gap-1 font-bold">
                <CheckCircle2 size={12} />
                <span>Complete</span>
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-semibold">
              <div>
                <span className="block text-slate-500 text-[10px] uppercase mb-0.5">Total Accounts</span>
                <span className="text-slate-300 font-mono">{updateSummary.total}</span>
              </div>
              <div>
                <span className="block text-slate-500 text-[10px] uppercase mb-0.5">Successfully Updated</span>
                <span className="text-green-400 font-mono font-bold">{updateSummary.updated}</span>
              </div>
              <div>
                <span className="block text-slate-500 text-[10px] uppercase mb-0.5">Failed</span>
                <span className={`font-mono font-bold ${updateSummary.failed > 0 ? "text-red-400" : "text-slate-300"}`}>
                  {updateSummary.failed}
                </span>
              </div>
              <div>
                <span className="block text-slate-500 text-[10px] uppercase mb-0.5">Skipped</span>
                <span className="text-slate-500 font-mono">{updateSummary.skipped}</span>
              </div>
            </div>

            {/* List failures if any */}
            {updateSummary.failed_details.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-900">
                <span className="block text-red-400 text-[10px] font-bold uppercase tracking-wider">Failed Profiles Detail</span>
                <div className="space-y-1">
                  {updateSummary.failed_details.map(fail => (
                    <div key={fail.username} className="flex justify-between items-center text-xs p-2 bg-red-500/5 border border-red-500/10 rounded-lg text-red-400 font-medium">
                      <span>@{fail.username}</span>
                      <span className="text-[10px] text-red-500 font-mono">{fail.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
