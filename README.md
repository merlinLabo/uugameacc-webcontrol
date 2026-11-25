A Node.js tool adds a control to the local UniFi Network app to control `uuplugin` service. 

UniFi OS or UniFi Network app updates will overwrite the modified files, so the tool may need changes to work with future versions.

### Installation

Download the repository, then copy it to your UCG and run the installer:

```sh
scp -r uuplugin-webcontrol root@192.168.0.1:/data/
ssh root@192.168.0.1
bash /data/uuplugin-webcontrol/install.sh
```

If you encounter a `Permission denied` error when running the scripts directly, make them executable:

```sh
chmod +x /data/uuplugin-webcontrol/install.sh \
         /data/uuplugin-webcontrol/uninstall.sh
```
