include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-vnt2
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-vnt2
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI support for VNT2 Virtual Network
  PKGARCH:=all
  DEPENDS:=+luci-base
endef

define Package/luci-app-vnt2/description
  LuCI web interface for VNT2 virtual network.
  Manages vnt2_cli (client), vnts2 (server), vnt2_ctrl and vnt2_web.
  Features: full parameter configuration, binary download management,
  auto-update, UPX compression and SHA256 verification.
endef

define Package/luci-app-vnt2/conffiles
/etc/config/vnt2
endef

define Build/Compile
endef

define Package/luci-app-vnt2/install
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-vnt2.json $(1)/usr/share/luci/menu.d/

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-vnt2.json $(1)/usr/share/rpcd/acl.d/

	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/vnt2
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/vnt2/*.js $(1)/www/luci-static/resources/view/vnt2/

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./root/etc/config/vnt2 $(1)/etc/config/

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./root/etc/init.d/vnt2_client $(1)/etc/init.d/
	$(INSTALL_BIN) ./root/etc/init.d/vnt2_server $(1)/etc/init.d/

	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./root/etc/uci-defaults/40_luci-vnt2 $(1)/etc/uci-defaults/

	$(INSTALL_DIR) $(1)/usr/share/vnt2
	$(INSTALL_BIN) ./root/usr/share/vnt2/vnt2_api.sh $(1)/usr/share/vnt2/
endef

define Package/luci-app-vnt2/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	( . /etc/uci-defaults/40_luci-vnt2 ) && rm -f /etc/uci-defaults/40_luci-vnt2
	/usr/share/vnt2/vnt2_api.sh setup_cron 2>/dev/null
	rm -f /tmp/luci-indexcache
	rm -rf /tmp/luci-modulecache/
}
exit 0
endef

$(eval $(call BuildPackage,luci-app-vnt2))
