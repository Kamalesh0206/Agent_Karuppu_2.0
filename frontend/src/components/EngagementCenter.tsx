import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config.ts';
import { 
  BarChart3, RefreshCw, Copy, ExternalLink, MessageSquare, Heart, Image as ImageIcon, 
  Video, Eye, Search, AlertCircle, Calendar, MessageCircle, UserCheck, ShieldCheck, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface SyncedPost {
  id: number;
  media_id: string;
  media_url: string;
  caption: string;
  media_type: string;
  like_count: number;
  comment_count: number;
  permalink: string;
  published_at: string;
  instagram_username: string;
}

interface Analytics {
  total_posts: number;
  total_likes: number;
  total_comments: number;
  engagement_rate: number;
}

interface GroupAccount {
  id: number;
  instagram_username: string;
  profile_picture: string | null;
  facebook_page_name: string | null;
  status: string;
}

interface Comment {
  id: string;
  username: string;
  text: string;
  timestamp: string;
}

interface EngagementCenterProps {
  groupId: number;
  accounts: GroupAccount[];
}

export default function EngagementCenter({ groupId, accounts }: EngagementCenterProps) {
  const [posts, setPosts] = useState<SyncedPost[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filters & Pagination
  const [searchTerm, setSearchTerm] = useState('');
  const [mediaTypeFilter, setMediaTypeFilter] = useState('');
  const [accountFilter, setAccountFilter] = useState<number | ''>('');
  const [page, setPage] = useState(1);
  const [totalPosts, setTotalPosts] = useState(0);
  const limit = 6;

  // Comments drawer/modal
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentsError, setCommentsError] = useState('');

  useEffect(() => {
    fetchData();
  }, [groupId, searchTerm, mediaTypeFilter, accountFilter, page]);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [postsRes, analyticsRes] = await Promise.all([
        axios.get(`${API_URL}/groups/${groupId}/engagement/posts`, {
          params: {
            search: searchTerm || undefined,
            media_type: mediaTypeFilter || undefined,
            account_id: accountFilter || undefined,
            page,
            limit
          },
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
        }),
        axios.get(`${API_URL}/groups/${groupId}/engagement/analytics`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
        })
      ]);
      setPosts(postsRes.data.posts);
      setTotalPosts(postsRes.data.total);
      setAnalytics(analyticsRes.data);
    } catch (err: any) {
      setError('Failed to retrieve engagement statistics.');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncEngagement = async () => {
    setSyncing(true);
    setError('');
    setSuccess('');
    try {
      const res = await axios.post(`${API_URL}/groups/${groupId}/engagement/sync`, {}, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setSuccess(res.data.detail || 'Metrics updated successfully.');
      setPage(1);
      fetchData();
    } catch (err: any) {
      setError('Sync failed. Please check access token permissions.');
    } finally {
      setSyncing(false);
    }
  };

  const handleOpenComments = async (postId: number) => {
    setSelectedPostId(postId);
    setComments([]);
    setLoadingComments(true);
    setCommentsError('');
    try {
      const res = await axios.get(`${API_URL}/instagram/posts/${postId}/comments`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setComments(res.data);
    } catch (err: any) {
      setCommentsError('Failed to retrieve real-time comments.');
    } finally {
      setLoadingComments(false);
    }
  };

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setSuccess(`${type} copied to clipboard!`);
    setTimeout(() => setSuccess(''), 2000);
  };

  return (
    <div className="space-y-6">
      
      {/* Sync control and notification header */}
      <div className="flex justify-between items-center bg-slate-900/10 p-4 border border-slate-900 rounded-xl">
        <div className="space-y-0.5">
          <h3 className="text-sm font-bold text-slate-300">Synchronize Feeds</h3>
          <p className="text-[11px] text-slate-500">Sync is restricted to manual execution to optimize Meta Graph API rate limits.</p>
        </div>
        <button
          onClick={handleSyncEngagement}
          disabled={syncing}
          className="px-4 py-2 border border-purple-500/20 hover:border-purple-500/40 bg-purple-500/5 hover:bg-purple-500/10 text-purple-400 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
          <span>{syncing ? 'Synchronizing...' : 'Sync Post Stats'}</span>
        </button>
      </div>

      {success && (
        <div className="p-3 bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-semibold rounded-xl flex items-center gap-2">
          <ShieldCheck size={14} />
          <span>{success}</span>
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold rounded-xl flex items-center gap-2">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* 1. Analytics Cards */}
      {analytics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="glass-panel p-4 rounded-xl border border-slate-900 bg-slate-900/10 flex flex-col justify-between">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Total Synced Posts</span>
            <div className="flex items-baseline gap-1 mt-2">
              <span className="text-xl font-black text-slate-200">{analytics.total_posts}</span>
              <span className="text-[10px] text-slate-500">posts</span>
            </div>
          </div>
          <div className="glass-panel p-4 rounded-xl border border-slate-900 bg-slate-900/10 flex flex-col justify-between">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Total Likes</span>
            <div className="flex items-baseline gap-1 mt-2">
              <span className="text-xl font-black text-pink-400">{analytics.total_likes.toLocaleString()}</span>
              <Heart size={10} className="text-pink-400/60" />
            </div>
          </div>
          <div className="glass-panel p-4 rounded-xl border border-slate-900 bg-slate-900/10 flex flex-col justify-between">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Total Comments</span>
            <div className="flex items-baseline gap-1 mt-2">
              <span className="text-xl font-black text-purple-400">{analytics.total_comments.toLocaleString()}</span>
              <MessageSquare size={10} className="text-purple-400/60" />
            </div>
          </div>
          <div className="glass-panel p-4 rounded-xl border border-slate-900 bg-slate-900/10 flex flex-col justify-between">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Engagement Rate</span>
            <div className="flex items-baseline gap-1 mt-2">
              <span className="text-xl font-black text-green-400">{analytics.engagement_rate}%</span>
              <BarChart3 size={10} className="text-green-400/60" />
            </div>
          </div>
        </div>
      )}

      {/* 2. Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-950/20 p-4 border border-slate-900 rounded-xl">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-3.5 text-slate-600" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
            placeholder="Search captions..."
            className="w-full pl-9 pr-4 py-2 bg-slate-900/50 border border-slate-800 focus:border-purple-500/50 outline-none text-xs rounded-lg text-slate-200 placeholder:text-slate-600"
          />
        </div>
        
        <select
          value={mediaTypeFilter}
          onChange={(e) => { setMediaTypeFilter(e.target.value); setPage(1); }}
          className="bg-slate-900/50 border border-slate-800 text-xs rounded-lg text-slate-300 outline-none px-3 py-2"
        >
          <option value="">All Media Types</option>
          <option value="IMAGE">Image</option>
          <option value="VIDEO">Video / Reels</option>
          <option value="CAROUSEL_ALBUM">Carousel Album</option>
        </select>

        <select
          value={accountFilter}
          onChange={(e) => { setAccountFilter(e.target.value ? Number(e.target.value) : ''); setPage(1); }}
          className="bg-slate-900/50 border border-slate-800 text-xs rounded-lg text-slate-300 outline-none px-3 py-2"
        >
          <option value="">All Connected Accounts</option>
          {accounts.map(acc => (
            <option key={acc.id} value={acc.id}>@{acc.instagram_username}</option>
          ))}
        </select>
      </div>

      {/* 3. Post Feed Grid */}
      {loading ? (
        <div className="text-center py-12">
          <RefreshCw size={24} className="animate-spin text-purple-500 mx-auto" />
        </div>
      ) : posts.length === 0 ? (
        <div className="glass-panel p-12 text-center rounded-xl border border-slate-900">
          <p className="text-xs text-slate-500">No matching posts found. Sync metrics to pull feed parameters.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {posts.map(post => (
              <div key={post.id} className="glass-panel border border-slate-900 bg-slate-900/20 rounded-xl overflow-hidden flex flex-col justify-between shadow-md">
                
                {/* Media Thumbnail */}
                <div className="relative aspect-video w-full bg-slate-950 overflow-hidden border-b border-slate-900">
                  {post.media_type === 'VIDEO' ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-purple-950/20">
                      <Video size={36} className="text-purple-400" />
                    </div>
                  ) : (
                    <img src={post.media_url || "https://picsum.photos/400/300"} className="w-full h-full object-cover" alt="IG Thumbnail" />
                  )}
                  <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[8px] font-bold text-slate-300 tracking-wide uppercase">
                    {post.media_type}
                  </span>
                  <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-lg bg-purple-600/90 text-[9px] font-bold text-white shadow">
                    @{post.instagram_username}
                  </span>
                </div>

                {/* Caption / Stats Body */}
                <div className="p-4 space-y-3">
                  <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed min-h-[50px]">
                    {post.caption || <span className="italic text-slate-700">No caption.</span>}
                  </p>

                  <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-900/60">
                    <span className="text-[10px] text-slate-500 font-medium flex items-center gap-1">
                      <Calendar size={10} />
                      {new Date(post.published_at).toLocaleDateString()}
                    </span>

                    <div className="flex gap-3 font-semibold text-slate-300">
                      <span className="flex items-center gap-1 text-[11px]">
                        <Heart size={11} className="text-pink-500" />
                        {post.like_count}
                      </span>
                      <span className="flex items-center gap-1 text-[11px]">
                        <MessageCircle size={11} className="text-purple-400" />
                        {post.comment_count}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions Bar */}
                <div className="px-4 py-3 bg-slate-950/30 border-t border-slate-900 grid grid-cols-4 gap-1 text-center">
                  <a
                    href={post.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1.5 hover:bg-slate-900 rounded text-slate-400 hover:text-slate-200 transition-colors flex flex-col items-center gap-0.5 cursor-pointer"
                    title="Open in Instagram"
                  >
                    <ExternalLink size={12} />
                    <span className="text-[8px]">Open</span>
                  </a>
                  <button
                    onClick={() => copyToClipboard(post.permalink, 'Link')}
                    className="p-1.5 hover:bg-slate-900 rounded text-slate-400 hover:text-slate-200 transition-colors flex flex-col items-center gap-0.5 cursor-pointer"
                    title="Copy Link"
                  >
                    <Copy size={12} />
                    <span className="text-[8px]">Copy Link</span>
                  </button>
                  <button
                    onClick={() => copyToClipboard(post.caption, 'Caption')}
                    className="p-1.5 hover:bg-slate-900 rounded text-slate-400 hover:text-slate-200 transition-colors flex flex-col items-center gap-0.5 cursor-pointer"
                    title="Copy Caption"
                  >
                    <Copy size={12} />
                    <span className="text-[8px]">Caption</span>
                  </button>
                  <button
                    onClick={() => handleOpenComments(post.id)}
                    className="p-1.5 hover:bg-slate-900 rounded text-slate-400 hover:text-slate-200 transition-colors flex flex-col items-center gap-0.5 cursor-pointer"
                    title="View Comments"
                  >
                    <MessageSquare size={12} />
                    <span className="text-[8px]">Comments</span>
                  </button>
                </div>

              </div>
            ))}
          </div>

          {/* Search Pagination controls */}
          {totalPosts > limit && (
            <div className="flex justify-center items-center gap-3 pt-4">
              <button
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
                className="px-3 py-1 bg-slate-900 border border-slate-800 text-xs rounded text-slate-300 hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
              >
                Previous
              </button>
              <span className="text-xs text-slate-500">Page {page} of {Math.ceil(totalPosts / limit)}</span>
              <button
                disabled={page * limit >= totalPosts}
                onClick={() => setPage(page + 1)}
                className="px-3 py-1 bg-slate-900 border border-slate-800 text-xs rounded text-slate-300 hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* --- Real-Time Comments Dialog Modal --- */}
      <AnimatePresence>
        {selectedPostId !== null && (
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedPostId(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-panel w-full max-w-lg rounded-2xl border border-slate-800 shadow-2xl relative overflow-hidden flex flex-col z-10"
            >
              <div className="px-6 py-4 border-b border-slate-900 flex justify-between items-center bg-slate-950/40">
                <h3 className="text-md font-bold font-outfit text-slate-100 flex items-center gap-2">
                  <MessageSquare size={16} className="text-purple-400" />
                  <span>Real-Time Comments</span>
                </h3>
                <button
                  onClick={() => setSelectedPostId(null)}
                  className="text-slate-500 hover:text-slate-300 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-6 space-y-4 max-h-[50vh] overflow-y-auto bg-slate-950/20">
                {loadingComments ? (
                  <div className="text-center py-8">
                    <RefreshCw size={20} className="animate-spin text-purple-500 mx-auto" />
                  </div>
                ) : commentsError ? (
                  <div className="p-3 bg-red-500/10 text-red-400 text-xs rounded-xl text-center font-semibold">
                    {commentsError}
                  </div>
                ) : comments.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-6">No comments recorded on this post yet.</p>
                ) : (
                  comments.map(c => (
                    <div key={c.id} className="p-3 bg-slate-900/30 border border-slate-900 rounded-xl space-y-1">
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="font-bold text-purple-400">@{c.username}</span>
                        <span className="text-slate-500">{new Date(c.timestamp).toLocaleString()}</span>
                      </div>
                      <p className="text-xs text-slate-300">{c.text}</p>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
