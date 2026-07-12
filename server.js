<!-- Add this inside your <script> tag or at the bottom of your HTML -->
<script>
  async function handleLogout() {
    try {
      const res = await fetch('/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const data = await res.json();
      
      if (data.success) {
        // Force a hard reload to clear any cached JS state
        window.location.replace('/login.html');
      } else {
        alert('Logout failed: ' + data.error);
      }
    } catch (err) {
      console.error('Logout error:', err);
      alert('Network error. Please try again.');
    }
  }

  // Attach to your button (ensure your button has id="logoutBtn")
  document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);
</script>