
# VNT 2.0 / VNTS 2.0 Networking Guide

## 1. Install luci-app-vnt2

### Quick Install (run in terminal)

```bash
curl -fsSL "https://gitlab.com/whzhni/tailscale/-/raw/main/Auto_Install_Script.sh" | sh -s luci-app-vnt2
```

or

```bash
wget -q -O - "https://gitlab.com/whzhni/tailscale/-/raw/main/Auto_Install_Script.sh" | sh -s luci-app-vnt2
```

### Manual Install

Download the IPK file for your architecture from:

- GitHub Releases: https://github.com/whzhni1/luci-app-vnt2/releases
- Gitee (for users in China): https://gitee.com/whzhni/luci-app-vnt2/releases
- GitLab backup: https://gitlab.com/whzhni/luci-app-vnt2/-/releases

> When you install `luci-app-vnt2`, the required `vnt` and `vnts` binaries will be downloaded automatically. In some regions downloads may fail due to network issues. Follow the guidance on the luci-app-vnt2 main page to set a mirror source, then download via the “Update” interface.

---

## 2. Example: Connect Router A and Router B

Assume:

- **Router A** LAN address: `192.168.11.1`
- **Router B** LAN address: `192.168.68.1`

Goal: allow devices in both local networks to access each other.

---

## 3. VNT Client Configuration

Path: `luci-app-vnt2` → Config Management → Client Config → New Config

### Common Settings (same for both Router A and B)

| Setting                    | Description |
| -------------------------- | ----------- |
| Config Name                | Any name (e.g., `A` for Router A, `B` for Router B) |
| Network ID                 | **Must be identical on both routers** |
| Server Address             | Official server: `quic://101.35.230.139:6660` or self‑hosted address (see later) |
| Custom Virtual IP          | Router A: `10.26.0.3`, Router B: `10.26.0.6` (you can plan your own) |
| Inbound Listened Subnet    | Router A: the other side's LAN – `192.168.68.0/24,10.26.0.6`<br>Router B: `192.168.11.0/24,10.26.0.3` |
| Outbound Allowed Subnet    | Local LAN subnet (e.g., Router A `192.168.11.0/24`, Router B `192.168.68.0/24`). You can also use `0.0.0.0/0` to allow all. |
| Virtual Interface Name     | Leave empty for auto‑generation |
| Device Name                | Leave empty for auto‑detection |
| Device Unique ID           | Router A: `10.26.0.3`, Router B: `10.26.0.6` (can be custom but must be unique) |
| Encryption Password        | **Must be identical on both routers** – recommended |
| Web UI Listen Address      | Local LAN address:port (e.g., Router A `192.168.11.1:29870`). **Do not use the same port for multiple instances** |

### Save & Apply

1. Click **Save Config** at the bottom
2. Select the newly created config
3. Click **Save & Apply**

> Reference images:  
> ![Reference](../Image/A_vnt2_config.png)  
> ![Reference](../Image/B_vnt2_config.png)

---

## 4. VNT Server Configuration (Self‑hosted, requires a public IP)

Path: `luci-app-vnt2` → Config Management → Server Config → New Config

### Settings

| Setting                     | Example value                    | Description |
| --------------------------- | -------------------------------- | ----------- |
| Config Name                 | Any (e.g., `my_vnts`)            |             |
| TCP Listen Address          | `192.168.68.1:29880`             | At least one of TCP/QUIC/WSS must be filled |
| QUIC Listen Address         | Optional, leave empty to disable |             |
| WSS Listen Address          | Optional, leave empty to disable |             |
| Default Virtual Subnet      | `10.22.23.0/24`                  | Can be customised |
| Network Whitelist           | Recommend to fill (e.g., `whzhni`) | Leave empty for no restriction |
| Web UI Listen Address       | `192.168.68.1:29888`             | For the web management interface |
| Web UI Username             | Custom (e.g., `admin`)           |             |
| Web UI Password             | Custom (e.g., `admin`)           |             |

### Save & Apply

1. Click **Save Config** at the bottom
2. Select the newly created config
3. Click **Save & Apply**

> Reference image: ![Reference](../Image/A_vnts2_config.png)

---

## 5. Connect a Client to a Self‑hosted Server

The configuration is almost the same as the **client config** above. The only difference is the **Server Address** – fill in the public address of your self‑hosted server.

### Format Reference

| Protocol opened on server | Client `server` value format          |
| ------------------------- | ------------------------------------- |
| TCP                       | `tcp://your_public_ip:port`           |
| QUIC                      | `quic://your_public_ip:port`          |
| WSS                       | `wss://your_domain:port` (TLS cert required) |

> It is recommended to use a domain name resolved by DDNS. DDNS configuration is not covered here.

### Reference image

- ![Reference](../Image/vnt_A_vnts2_config.png)

---

## 6. Frequently Asked Questions

- **Multiple server addresses**: Create separate instances, each with one server address. Do not put multiple addresses in a single configuration – if one server fails, the connection may break.
- **Web UI port conflicts**: The Web UI port for each instance must be unique.
- **Self‑hosted server port conflicts**: Within the same instance, listening ports (TCP, QUIC, WSS, Web UI) must also be different from each other.

---

**Enjoy your VNT network!**
```

