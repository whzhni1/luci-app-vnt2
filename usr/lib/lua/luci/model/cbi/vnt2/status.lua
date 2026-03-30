local luci = require("luci")
local status = luci.model.cbi.Pref({
    title = "VNT2 Status Dashboard",
    description = "Real-time status dashboard for VNT2.",
})

local function get_client_status()
    -- Function to get VNT2 client status
    return { active = 50, inactive = 10 }
end

local function get_server_status()
    -- Function to get server status
    return "Online"
end

local function get_online_clients_count()
    -- Function to get count of online clients
    return 42
end

local function get_network_performance()
    -- Function to get network performance metrics
    return { latency = "20ms", throughput = "100Mbps" }
end

function status.render()
    local dashboard = luci.template.render("vnt2/status")
    dashboard.client_status = get_client_status()
    dashboard.server_status = get_server_status()
    dashboard.online_clients = get_online_clients_count()
    dashboard.network_performance = get_network_performance()
    return dashboard
end

local function quick_action_buttons()
    return {
        { name = "Restart", action = "restart_command()" },
        { name = "Refresh", action = "refresh_command()" }
    }
end
status.quick_actions = quick_action_buttons()