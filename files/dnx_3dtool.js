/*
 * dnx_3dtool — 3D Waterfall (Spectrogram) plugin for OpenWebRX+
 *
 * WebGL port of the SDRangel 3D spectrogram:
 *   sdrangel/sdrgui/gui/glshaderspectrogram.{h,cpp}  (grid mesh + data texture,
 *   height displacement in the vertex shader, colour map lookup, ring-buffer
 *   texture offset, Points/Lines/Solid/Outline/Shaded styles, camera model)
 *   sdrangel/sdrgui/gui/glspectrumview.cpp            (row upload, mouse / key
 *   handling: rotate, pan, Z-scale, vertical angle, light)
 *   Copyright (C) 2022 Jon Beniston, M7RCE <jon@beniston.com>
 *   Copyright (C) 2016 Edouard Griffiths, F4EXB
 *   Licensed under GNU GPL v3 — this port is a derivative work, GPL v3 as well.
 *
 * Differences to SDRangel (browser specific):
 *   - data texture is LUMINANCE_ALPHA (16 bit dB*100) and the dB->height
 *     mapping is done in the shader, so waterfall level changes (also the
 *     continuous auto-level mode) need no texture rebuild
 *   - normals are computed in the vertex shader with central differences
 *     (WebGL has no geometry shaders)
 *   - extra "traces" style (hidden-line frequency sweeps)
 *   - follows the OpenWebRX zoom (visible frequency range), click-to-tune
 *
 * v1.2 — SDRangel spectrum toolbar controls plus selectable 2D/3D layout:
 *   - SDRangel colour maps (sdrbase/util/colormap.cpp) for the 3D surface and
 *     as extra themes in the OpenWebRX waterfall theme list
 *   - averaging No / Mov (moving) / Fix (fixed block) / Max (max hold), N
 *   - max FPS, Log/Lin height scale, Play/Pause, save PNG
 *   - 2D only / 3D only / both split view, with top/bottom swap
 *   - corrected default waterfall time direction (newest at the top/far edge)
 *
 * No core files (Waterfall.js / Spectrum.js / waterfall.py) are modified:
 * the plugin wraps the global waterfall_add() and reads Waterfall.colors /
 * Waterfall.getRange() at draw time.
 */

(function (P) {
    'use strict';

    P._version = 1.2;
    P._projectionMode = 'sdrangel-physical-perspective';

    // ------------------------------------------------------------------
    // Settings
    // ------------------------------------------------------------------

    var LS_KEY = 'dnx_3dtool';

    var DEFAULTS = {
        enabled:     false,
        style:       'outline',   // points | lines | traces | solid | outline | shaded
        rows:        256,         // history lines (texture height)
        cols:        512,         // mesh columns (texture width)
        invert:      true,        // true: newest line at the far/top edge (downward waterfall flow)
        viewMode:    'std',       // std | 3d | both (2D waterfall, 3D, or split view)
        splitFlip:   false,       // in both mode: 2D top / 3D bottom, or 3D top / 2D bottom
        layoutVersion: 2,
        fps:         30,          // max frames per second
        heightScale: 1.0,         // userScaleZ
        colormap:    'owrx',      // 'owrx' = follow the OpenWebRX waterfall theme, or a SDRangel map name
        avgType:     'no',        // no | mov | fix | max   (SDRangel averaging type)
        avgN:        10,          // averaging count
        linear:      false,       // false: dB (log) height, true: linear power height
        baseHeight:  0.40,        // scaleZ relative to the surface depth
        showFrame:   true,
        showMarker:  true,
        showLabels:  true,
        backdrop:    0.55,        // darkness of the backdrop behind the surface (0..1)
        view: { rotX: -45, rotY: 0, rotZ: 0, tx: 0, ty: 0, tz: 0, fov: 45, lightEl: -35, lightAz: -30 }
    };

    function loadSettings() {
        var s = JSON.parse(JSON.stringify(DEFAULTS));
        try {
            var raw = window.localStorage.getItem(LS_KEY);
            if (raw) {
                var o = JSON.parse(raw);
                for (var k in o) {
                    if (k === 'view') { for (var v in o.view) s.view[v] = o.view[v]; }
                    else s[k] = o[k];
                }
                // v1.1 saved no explicit layout/direction.  The original
                // default made the history appear to climb upward; migrate
                // old settings to the normal downward flow and keep a useful
                // mode when the user had already enabled 3D.
                if (!o.layoutVersion || o.layoutVersion < 2) {
                    s.layoutVersion = 2;
                    s.invert = true;
                    s.viewMode = s.enabled ? '3d' : 'std';
                    s.splitFlip = false;
                }
            }
        } catch (e) { /* ignore */ }
        return s;
    }

    function saveSettings(s) {
        try { window.localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------------------------
    // SDRangel colour maps
    // ------------------------------------------------------------------

    // SDRangel colour maps (sdrbase/util/colormap.cpp), 64 anchors (256 for maps with hard edges), RGB hex
    var SDR_MAPS = {
        "A.C.A.B.": '0000000303030505050808080b0b0b0d0d0d1010101313131515151818181b1b1b1d1d1d2020202323232525252828282b2b2b2d2d2d3030303232323535353838383a3a3a3d3d3d4040404242424545454848484a4a4a4d4d4d50505052525255555552525a5050604d4d654a4a6a48487045457542427a4040803d3d853a3a8a38388f35359532329a30309f2d2da52b2baa2828af2525b52323ba2020bf1d1dc51b1bca1818cf1515d41313da1010df0d0de40b0bea0808ef0505f40303fa0000ff0008ff0010ff0018ff0020ff0028ff0030ff0038ff0040ff0048ff0050ff0058ff0060ff0068ff0070ff0078ff0080ff0087ff008fff0097ff009fff00a7ff00afff00b7ff00bfff00c7ff00cfff00d7ff00dfff00e7ff00efff00f7ff00ffff00fff700ffef00ffe700ffdf00ffd700ffcf00ffc700ffbf00ffb700ffaf00ffa700ff9f00ff9700ff8f00ff8700ff8000ff7800ff7000ff6800ff6000ff5800ff5000ff4800ff4000ff3800ff3000ff2800ff2000ff1800ff1000ff0800ff0008ff0010ff0018ff0020ff0028ff0030ff0038ff0040ff0048ff0050ff0058ff0060ff0068ff0070ff0078ff0080ff0087ff008fff0097ff009fff00a7ff00afff00b7ff00bfff00c7ff00cfff00d7ff00dfff00e7ff00efff00f7ff00ffff00fff700ffef00ffe700ffdf00ffd700ffcf00ffc700ffbf00ffb700ffaf00ffa700ff9f00ff9700ff8f00ff8700ff8000ff7800ff7000ff6800ff6000ff5800ff5000ff4800ff4000ff3800ff3000ff2800ff2000ff1800ff1000ff0800ff0000ff0008ff0010ff0018ff0020ff0028ff0030ff0038ff0040ff0048ff0050ff0058ff0060ff0068ff0070ff0078ff0080ff0087ff008fff0097ff009fff00a7ff00afff00b7ff00bfff00c7ff00cfff00d7ff00dfff00e7ff00efff00f7ff00ffff08ffff10ffff18ffff20ffff28ffff30ffff38ffff40ffff48ffff50ffff58ffff60ffff68ffff70ffff78ffff80ffff87ffff8fffff97ffff9fffffa7ffffafffffb7ffffbfffffc7ffffcfffffd7ffffdfffffe7ffffeffffff7ff',
        "Acton": '2e214d3225503628543a2c583e305b43335f4737634b3b66503e6a54426e5946725f4a76644e7a69517d6e5480735783795a867e5d89835f8b88618d8d628f9263909764919c6592a06593a56693a96694ad6795b26795b76896bb6a98c06c99c6709cca739fce77a2d17ba5d37fa8d483abd587aed58bb0d58eb3d491b5d495b8d498bad49bbcd39fbfd3a2c1d3a6c4d4a9c6d4adc9d5b0cbd5b4ced6b8d0d7bdd4d9c1d7dac5d9dbc9dcddcddfded1e2dfd5e4e1d9e7e3ddeae4e1ede6e6f0',
        "Angel": '00000f00011000011100011200021300021400021500031600031700041800051900051a00061b00071c00071d00081e00091f000a20000a21000b22000c23000d24000e25000f2600102700112800122900142a00152b00162c00172d00192e001a2f001b30001d31001e32001f33002134002235002436002637002738002939002b3a002c3b002e3c00303d00323e00333f003540003741003942003b43003d44003f45004146004347004648004849004a4a004b4a004c49004d49004e49004f48005048005148005247005347005446005545005645005744005843005943005a42005b41005c40005d40005e3f005f3e00603d00613c00623b00633a006439006538006636006735006834006933006a31006b30006c2f006d2d006e2c006f2b00702900712800722600732400742300752100761f00771e00781c00791a007a18007b17007c15007d13007e11007f0f00800d00810b008209008307008404008502008600028700058800078900098a000c8b000e8c00108d00138e00158f001890001b91001d92002093002394002595002896002b97002e9800309900339a00369b00399c003c9d003f9e00429f0045a00048a1004ca2004fa30052a40055a50059a6005ca7005fa80063a90066aa0069ab006dac0070ad0074ae0078af007bb0007fb10083b20086b3008ab4008eb50092b60095b70099b8009db900a1ba00a5bb00a9bc00adbd00b1be00b5bf00bac000bec100c2c200c3c000c4bd00c5bb00c6b900c7b600c8b400c9b200caaf00cbad00ccaa00cda700cea500cfa200d09f00d19d00d29a00d39700d49400d59200d68f00d78c00d88900d98600da8300db8000dc7d00dd7a00de7600df7300e07000e16d00e26900e36600e46300e55f00e65c00e75900e85500e95200ea4e00eb4a00ec4700ed4300ee3f00ef3c00f03800f13400f23000f32d00f42900f52500f62100f71d00f81900f91500fa1100fb0d00fc0800fd0400fe0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        "Bamako": '00404c03414b06434a0944480b46470e4845114944134b42154c41184e3f1a503e1e523c20543a2355382657372859352b5b332e5d31315f3034612e37632c3a652a3d6728416927446b25476d234b6f214e721f52741c56771a5a79185e7c16637f136882106c840e71870b7689087c8b06818d04868e038b8f039190049692069c940ba39710aa9b16b09f1cb7a423bea92ac5ae32cbb33ad0b841d5bc49dbc152dfc55ae3c961e7cd68ead06feed476f1d87df5db84f8df8bfce292ffe599',
        "Batlow": '011959051f5a08255b0b2b5c0d315d0e365e0f3b5f103f60114360124761134b61154f621753621957621c5a621f5d6123606027635f2c665d31695b376b583c6d56426f5248714f4f734c5575485b7745627941687b3e6f7d3a767f377d81348683308e852e95872c9d892ba58b2cad8c2db58e30bd8f34c49138cb923ed29343d9954ae09651e69858eb9a60f09c69f49f72f8a17bfaa485fca78efdaa97fdaea2fdb1abfdb4b4fdb7bcfdbac4fdbccdfcbfd6fcc3dffbc6e8fbc9f1faccfa',
        "Buda": 'b301b3b309afb311acb317a9b31ca6b321a3b326a0b32b9eb32f9cb4339ab53798b63c96b74095b84494b94892bb4b91bc4f90bd538fbe568dbf5a8cc15d8bc2618ac36489c46888c56b86c66e85c77284c97583ca7982cb7c81cc7f80cd837fce877ecf8a7dd08e7cd1917bd1957ad29879d39c78d49f78d5a377d6a676d7aa75d8ad74d8b173d9b572dab871dbbc71dcbf70ddc36fdec76edfca6de0ce6ce1d36be2d76ae3db69e5df68e7e368eae767edec67f1f066f6f566fafa66ffff66',
        "Cool": '00ffff04fbff08f7ff0cf3ff10efff14ebff18e7ff1ce3ff20dfff24dbff28d7ff2dd2ff31ceff35caff39c6ff3dc2ff41beff45baff49b6ff4db2ff51aeff55aaff59a6ff5da2ff619eff659aff6996ff6d92ff718eff758aff7986ff7d82ff827dff8679ff8a75ff8e71ff926dff9669ff9a65ff9e61ffa25dffa659ffaa55ffae51ffb24dffb649ffba45ffbe41ffc23dffc639ffca35ffce31ffd22dffd728ffdb24ffdf20ffe31cffe718ffeb14ffef10fff30cfff708fffb04ffff00ff',
        "Cubegamma": '0000000928100c34170f3c1d114322134927144e2c165231175635185a3a1a5e3e1b61431c64471e664b1f6950206b54226d58236f5c2571602673642874692a766d2b77702d78752f7a78317b7c337c80357d84377d87397e8b3b7f8e3e809240809543819845819c48819f4a82a24d82a44f82a75283aa5583ad5883af5b83b25e83b46083b66383b96683bb6983bc6c83be6f83c07283c27683c37983c57c83c67f83c78283c88583c98883ca8b82cb8e82cc9182cd9482cd9782cd9a82ce9d82cea082cea383cea683cea983ceab83ceae83cdb083cdb383cdb684ccb884cbbb84cbbd85cabf85c9c285c8c486c7c686c7c887c6ca87c5cc88c3ce88c2cf89c1d18ac0d38abfd48bbdd58cbcd78dbbd88ebad98fb8db90b7dc90b6dd91b4dd92b3de93b2df95b0e096afe097aee198ace199abe29aaae29ca9e29da8e29ea7e29fa5e2a1a4e2a2a3e2a3a2e2a5a1e2a6a0e2a89fe1a99fe1aa9ee1ac9de0ad9de0af9cdfb09bdfb29bdeb39bddb59addb69adcb89adbb99adaba99dabc99d9bd99d8bf99d7c09ad6c29ad5c39ad4c49ad3c69bd3c79bd2c89cd1ca9cd0cb9dcfcd9ecece9fcdcf9fcdd0a0cbd1a1cbd3a2cad4a3c9d5a4c8d6a5c8d7a7c7d8a8c6d9a9c6daabc5dbacc5dcadc4ddafc4deb0c3dfb2c3e0b3c2e0b5c2e1b6c2e2b8c1e3bac1e3bbc1e4bdc1e5bec1e5c0c1e6c2c1e7c4c1e7c5c1e8c7c1e8c9c1e8cac1e9ccc2e9cec2ead0c2ead1c3ead3c3ebd5c4ebd6c4ebd8c5ebdac5ecdbc6ecddc7ecdec7ece0c8ece1c9ede2caede4caede5cbede7ccede8cdede9ceedebcfedecd0ededd1edeed2edefd3eef0d4eef1d5eef2d7eef3d8eef4d9eef5daeef6dbeef6dceef7ddeef8deeef8e0eef9e1eefae2eefae3effbe4effbe5effbe6effce7effce8effde9effdeaeffdebf0fdecf0fdedf0feeef0feeff1fef0f1fef1f1fef2f1fef3f2fef4f2fef4f2fef5f3fef6f3fef7f4fef7f4fef8f4fef8f5fef9f5fefaf6fefaf6fefbf6fefbf7fefbf7fefcf8fefcf8fefdf9fefdf9fefdfafefdfafefefbfefefbfefefcfefefdfefefdfefffefffffeffffffff',
        "Cubehelix": '000703000d0700140a001a0d00201400251b002a2200302b01353402383e043a46063f5408415e1043681644731c467c2347852c478d37479641489d4b48a45548a96148ad6d48b17948b58448b78e49b6994bb5a54cb5b04db4b850b4c053b4ca57b4d45ab4d95facde64a4e3699be86e92ea758ceb7c88ec8185ec8781ed8f80eb9680e99d80e7a57fe5ad7fe3b581e0bb85dec289dbc98cdad092d9d69ad8dda4d7e3acd8e7b5daebbedcefc7dff3d2e2f6dbe9f8e4eefaeaf6fcf3fcfefc',
        "Cubehlx2": '000000100f011c1803271e053223083c280c472c11512f165b321c6434236d372a783a34803c3d873e468d415093445a9746649c496e9f4d78a25182a3548ca55995a55d9fa562a7a567afa46cb7a372bea178c59f7eca9e84cf9c8ad39a90d79798da969edc94a4dd94abde93b0de93b6de93bcdd94c1dc95c6db97cbd99acfd79dd3d6a0d7d4a4dbd3a8ded2ade1d1b2e3d0b8e6d0bde8d0c3ead1c9ecd2d0eed4d6efd7dcf1dae2f3dde7f4e1ecf5e5f1f7eaf5f9eff9fbf4fcfdf9ffffff',
        "Devon": '2c1a4c2b1d502b21542b25582a295b2a2c5f29306329346729386a283b6e283f7227447827487c274d8127518628558b2959902b5d962d609c3063a23266a73669ad3a6cb23e6fb84472bd4a76c3517ac8597dcc6181d06985d47188d8798cdb8290df8a94e19197e4989be79e9ee9a4a2ebaaa5edaea9eeb2adefb6b0f0bab3f1bdb7f1c0baf2c3bef3c6c1f3cac5f4cdc8f5d0ccf5d3cff6d6d3f7dad6f7dedbf8e1def9e4e2fae8e5faebe9fbeeedfcf2f0fcf5f4fdf8f8fefcfbfeffffff',
        "Hawaii": '8c02738d0a6f8e126b8f1867901d6390216091265c922a59922e5593325293364f943b4b953f48954345964742964b40974f3d97533a985638985a35995f329963309a672d9a6b2a9b70289b74259c79239c7e209d831e9d881d9d8d1c9c921c9b991d9a9f2099a42497a92a94ae3091b3378eb73e8bbb4687be4e83c25780c55f7cc86778cb7074ce7970d0816dd38a69d69366d89c63dba561deae5fe0b75fe4c261e6ca66e8d36cebdb73ece27deee887efee92f0f39df1f7a8f2fab3f2fd',
        "Hot": '0300000d00001800002300002d00003800004200004d00005800006200006d00007a00008500008f00009a0000a50000af0000ba0000c50000cf0000da0000e40000ef0000fa0000ff0500ff1000ff1b00ff2500ff3000ff3a00ff4500ff5000ff5d00ff6800ff7200ff7d00ff8700ff9200ff9d00ffa700ffb200ffbd00ffc700ffd200ffdc00ffe700fff200fffc00ffff0cffff1cffff2cffff3cffff4cffff60ffff70ffff80ffff8fffff9fffffafffffbfffffcfffffdfffffefffffff',
        "Icy": '0000000c0c1b13142b181c381d2343212a4d24305627375e293d652b446c2d4a722f527831587d335e81356485366a88386f8b3a758e3c7b903e8092418594438a954590974894984b99994e9e9a51a29a55a79b58ab9b5caf9c60b29c64b69d6aba9d6ebe9e73c19f78c49f7dc7a082caa187cda28dcfa492d2a598d4a79dd6a9a3d8aba8daadaedcafb3deb2b9e0b5bee2b8c4e4bbc9e6bfcee7c3d3e9c7d9ebccdeedd1e2efd5e7f0daebf2dfeff4e4f3f6e9f6f8eff9faf4fcfdf9ffffff',
        "Imola": '1a33b31c36b11d39b01f3cae203ead2141ac2344aa2446a92549a8274ca6284ea52a52a32b54a22c57a12e599f2f5c9e305f9c32619b346499356698376896396b943b6d923d6f9040728d42748b447689467987497b854c7e834e818151848056887e598b7d5c8f7c60927b64967a679a796b9e786fa27773a67677aa757bae747fb27383b67287ba718bbe7090c26f94c76e98cb6d9dcf6ca2d46ba7d86aafde69b5e268bde667c4ea67cded66d5f066ddf466e6f666eef966f7fc66ffff66',
        "Jet": '0000830000930000a30000b30000c30000d30000e30000f30004ff0014ff0024ff0038ff0048ff0058ff0068ff0078ff0087ff0097ff00a7ff00b7ff00c7ff00d7ff00e7ff00f7ff08fff718ffe728ffd738ffc748ffb758ffa768ff9778ff878bff749bff64abff54bbff44cbff34dbff24ebff14fbff04fff300ffe300ffd300ffc300ffb300ffa300ff9300ff8300ff7400ff6400ff5400ff4400ff3400ff2000ff1000ff0000ef0000df0000cf0000bf0000af00009f00008f0000800000',
        "Lajolla": 'ffffccfffcc5fefabefef7b7fdf5affdf2a8fcefa1fbec9afbe992fae58bf9e184f8dc7bf6d774f5d26df4cc68f3c763f1c15ff0bc5befb759eeb257edad56eca855eba354ea9e53e99a53e89552e79052e68c51e48751e38251e17d50df7850dd724fda6c4ed6674ed2624dcd5d4cc7584bc15449ba5048b34d46ac4a44a547429d444096423e8f403b883e38813c357a3a3273382f6c362c6533285e3125562f214f2c1e492a1b4228183c26153624133022102a200d241e091f1c051a1a01',
        "Lapaz": '1a0c641c12681d176b1e1c6e202071212575222978232d7b24327e253681263a84273f8728438a29488c2a4c8f2c50912d54942e5896305c98325f9934639b36679d386b9e3b6f9f3e72a14176a2447aa2487da34c80a35084a45487a4588aa35e8ea36390a26893a26e95a17398a0789a9f7e9c9d839e9c899f9a8ea19994a29899a4979fa696a5a795aba995b2ab96b8ae97bfb199c7b59cceb99fd5bda4dec3abe4c9b2eaceb9efd3c0f3d8c8f6ddcff9e1d6fbe6ddfceae5fdeeecfef2f3',
        "Loggray": '0000000f0f0f1c1c1c2727273232323b3b3b4444444c4c4c5454545b5b5b6161616969696f6f6f7575757a7a7a7f7f7f8484848989898d8d8d9191919696969a9a9a9d9d9da1a1a1a5a5a5a8a8a8acacacafafafb2b2b2b5b5b5b8b8b8bbbbbbbfbfbfc1c1c1c4c4c4c7c7c7c9c9c9cccccccececed1d1d1d3d3d3d5d5d5d8d8d8dadadadcdcdcdededee0e0e0e2e2e2e4e4e4e6e6e6e8e8e8eaeaeaecececeeeeeef0f0f0f2f2f2f3f3f3f5f5f5f7f7f7f9f9f9fafafafcfcfcfdfdfdffffff',
        "Mint": '0000000710190b1a270e2232112b3c133244153a4b1741521948571b4f5c1d5560205d6422636825696a276f6d2a756f2d7a70308072338573368a743a8e753e9376429777469c784aa0784fa37953a77a58ab7a5dae7b62b17c68b47d6db77e74bb807abd8280c08385c2858bc58791c78997c98c9dcb8ea2cd91a8cf94aed197b4d39bb9d49fbed6a2c4d8a7c9daabcedcafd3ddb4d7dfb9dce1bee0e3c3e5e6c9e9e8cfecead4efecd9f2efdff5f1e4f8f4eafaf6effcf9f5fdfcfaffffff',
        "Parula": '3e26a8402ab4422ebf4332ca4537d5463bde4741e54746eb484cf04852f44757f7465efb4564fd426afe3e70ff3876fe327cfc2f82fa2e87f72d8cf32b91ef2797eb259be823a0e520a5e31da9e019addc12b1d608b4d101b7ca01bac409bdbd1ac0b525c2ae2cc4a632c69f38c89640ca8d4bcb8457cc7a64cd6f72cd6481cc598fcb4e9dc943abc739b8c431c5c22ad0bf27dbbd28e6bb2defba35f7ba3dfebe3cfec438feca33fcd030f9d62df7dd2af5e327f5e924f6ef20f7f51bf9fb15',
        "Plasma": '0d088719068c2206902a059331059738049a3f049c46039f4c02a15302a35901a56100a76700a86e00a87401a87a02a88004a88606a68b0aa5910ea39613a19c179ea11b9ba62098ab2494b02991b42d8db83289bd3786c13b82c5407ec9447acd4a76d14e72d5536fd8576bdb5c68de6164e26561e56a5de76f5aea7457ed7953ef7e50f2834cf48849f68d45f79342f9983efa9e3bfca338fca934fdaf31feb72dfebd2afdc328fdca26fcd025fbd724f9dd25f7e425f5eb27f2f227f0f921',
        "Prism": 'ff0000ff0000ff2100ff5200ff8200ffb000ffd800fff700e3ff00b2ff0081ff0053fe002be2000bbd3900917d0061b90030e90001ff1a00ff3e00ff6a00fe9a00d7cb00a3fa0063ff001dff0000ff0e00ff3e00ff6f00ff9e00ffc900ffec00f5ff00c6ff0095ff0065ff003aef0017cd1d00a3630074a20043d70013fe0d00ff2e00ff5700ff8600e9b700b9e7007eff003aff0000ff0000ff2a00ff5b00ff8c00ffb900ffdf00fffc00d9ff00a9ff0078ff004bf90024dc0006b54700878a0057c40026f00300ff2000ff4600ff7300f8a300ced40097ff0056ff000fff0000ff1700ff4800ff7900ffa700ffd000fff100ecff00bcff008bff005cff0032e90011c52b009a70006bae003ae0000aff1300ff3600ff6000ff8f00e1c100aef00071ff002cff0000ff0500ff3400ff6500ff9500ffc100ffe500ffff00d0ff009fff006fff0042f4001dd50e01ac55007e96004dcd001df70800ff2700ff4e00ff7c00f1ad00c4dd008bff0048ff0001ff0000ff2100ff5100ff8200ffb000ffd800fff700e3ff00b3ff0082ff0054fe002be3000bbd3900917d0061b90030e80001ff1900ff3e00ff6900fe9900d8ca00a3f90064ff001eff0000ff0e00ff3d00ff6f00ff9e00ffc800ffeb00f6ff00c6ff0095ff0066ff003bef0017cd1c00a4620075a20044d70014fe0d00ff2e00ff5700ff8600e9b700bae7007eff003aff0000ff0000ff2a00ff5b00ff8b00ffb800ffde00fffb00daff00a9ff0078ff004bfa0024dc0006b5460088890057c30027f00300ff2000ff4600ff7200f8a300cfd40097ff0056ff0010ff0000ff1700ff4700ff7800ffa700ffd000fff100edff00bdff008cff005dff0033e90011c62a009b6f006bad003ae0000bff1300ff3500ff6000ff8f00e1c000aff00071ff002cff0000ff0500ff3300ff6400ff9400ffc000ffe500ffff00d0ff009fff006fff0043f5001dd50d01ad54007f95004ecd001df70800ff2600ff4e00ff7c00f1ac00c5dd008bff0049ff0001ff0000ff2000ff5100ff8200ffaf00ffd700fff600e4ff00b3ff0082ff0054ff00',
        "Rainbow": '8000ff770dff7019ff6826fe5f32fe573efd504afc4856fb3f62fa376df93079f72686f51e91f3159bf20da5ef06aeed02b7eb0bc0e812c8e61acfe323d6e02bdddd32e3da3ae8d643edd34bf2cf52f5cb5af8c863fbc46afdc072febb7bffb784ffb28dfead95fda89cfba4a5f89fadf59ab4f295bced8fc5e88acde385d4dd80dcd67ae5cf74edc86ff4c069fdb763ffae5effa558ff9b52ff914cff8646ff793eff6d38ff6232ff562cff4a26ff3e1fff3219ff2613ff190dff0d06ff0000',
        "Shrimp": '0000000f0f0f1c1c1c2727273232323b3b3b4444444c4c4c5454545b5b5b6161616969696f6f6f7575757a7a7a7f7f7f8484848989898d8d8d9191919696969a9a9a9d9d9da1a1a1a5a5a5a8a8a8acacacafafafb2b2b2b5b5b5b8b8b8bbbbbbbfbfbfc1c1c1c4c4c4c7c7c7c9c9c9cccccccececed1d1d1d3d3d3d5d5d5d8d8d8dadadadcdcdcdededee0e0e0e2e2e2e4e4e4e6e6e6e8dfdaead5caeccabaeebea5f0b395f2a984f39e74f59463f78a53f97f42fa7532fc6a21fd6011ff5500',
        "Tokyo": '1a0e3421113727133a2d153e331741391a453f1c4845204c4b2350512754572b585f305c6435606939646e3e6773436a77486d7a4c707e5172805574835a76855e7886627a88667b896a7d8a6e7e8b72808c76818d79828e7d838e81848f8485908986918d8791908892948992988a939b8b949f8c94a38d95a68f96aa9097ae9198b2929ab6939bbb959dbf96a0c498a3c99ba7ce9dacd3a0b1d8a4b7dea8c0e5aec7eab2ceeeb7d5f2bcdcf5c1e3f8c5e9fac9effbcdf4fdd1f9fed5fefed8',
        "Turbo": '30123b351e58392a733d358b4040a2424bb54456c74661d6466be34776ee4680f6458cfd4196ff3ba0fd35abf82eb4f227bee920c7df1bd0d518d7ca18dec01ae4b620eaac2aefa135f39443f78752fa7a61fc6c71fe5f80ff538fff499cfe40a9fb39b4f836bef434c8ef34d2e935dbe236e3db38ebd339f1cb3af6c33afaba39fcb136fea732fe9b2dfe9029fc8423f9781ef66c19f26014ed5510e84b0ce14109da3907d23105ca2a04c12302b71d02ac1701a11201950d018808027a0403',
        "Viridis": '44015446075a470d6047136548186a481e6f482374482878472d7b46327e453781433d844241864046883e4a893c4f8a3a538b38588c365c8d34608d32648e31688e2f6c8e2d708e2c738e2a778e297b8e277f8e26828e24868e238a8d218e8d20928c1f968b1f9a8a1f9e891fa18721a58523a98326ad812ab07f2fb47c35b7793bbb7542be714ac16d52c5695ac86463cb5f6ccd5a75d0547fd34e89d54895d840a0da39aadc32b5de2bc0df25cae11fd5e21adfe318eae51af4e61efde725',
    };

    var SDR_NAMES = Object.keys(SDR_MAPS);

    // expand the anchor string to 256 [r,g,b] entries (linear interpolation)
    var cmapCache = {};
    function expandMap(name) {
        if (cmapCache[name]) return cmapCache[name];
        var hex = SDR_MAPS[name], n = hex.length / 6, anchors = [], i;
        for (i = 0; i < n; i++) {
            anchors.push([parseInt(hex.substr(i * 6, 2), 16), parseInt(hex.substr(i * 6 + 2, 2), 16), parseInt(hex.substr(i * 6 + 4, 2), 16)]);
        }
        var out = new Array(256);
        for (i = 0; i < 256; i++) {
            var pos = i * (n - 1) / 255, k = Math.min(n - 2, Math.floor(pos)), f = pos - k;
            var a = anchors[k], b = anchors[k + 1];
            out[i] = [Math.round(a[0] + f * (b[0] - a[0])), Math.round(a[1] + f * (b[1] - a[1])), Math.round(a[2] + f * (b[2] - a[2]))];
        }
        cmapCache[name] = out;
        return out;
    }

    // ------------------------------------------------------------------
    // Minimal 4x4 matrix helpers (column major, like OpenGL / QMatrix4x4)
    // ------------------------------------------------------------------

    var M4 = {
        identity: function () {
            var m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m;
        },
        mul: function (a, b) {            // a * b
            var o = new Float32Array(16);
            for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) {
                var s = 0;
                for (var k = 0; k < 4; k++) s += a[k * 4 + i] * b[j * 4 + k];
                o[j * 4 + i] = s;
            }
            return o;
        },
        translate: function (x, y, z) { var m = M4.identity(); m[12] = x; m[13] = y; m[14] = z; return m; },
        scale: function (x, y, z) { var m = M4.identity(); m[0] = x; m[5] = y; m[10] = z; return m; },
        rotateX: function (deg) {
            var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), m = M4.identity();
            m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m;
        },
        rotateY: function (deg) {
            var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), m = M4.identity();
            m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m;
        },
        rotateZ: function (deg) {
            var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), m = M4.identity();
            m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m;
        },
        perspective: function (fovDeg, aspect, near, far) {
            var f = 1 / Math.tan(fovDeg * Math.PI / 360), m = new Float32Array(16);
            m[0] = f / aspect; m[5] = f;
            m[10] = (far + near) / (near - far); m[11] = -1;
            m[14] = 2 * far * near / (near - far);
            return m;
        },
        ortho: function (left, right, bottom, top, near, far) {
            var m = new Float32Array(16);
            m[0] = 2 / (right - left);
            m[5] = 2 / (top - bottom);
            m[10] = -2 / (far - near);
            m[12] = -(right + left) / (right - left);
            m[13] = -(top + bottom) / (top - bottom);
            m[14] = -(far + near) / (far - near);
            m[15] = 1;
            return m;
        },
        invert: function (a) {
            var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
            var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
            var b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
            var b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
            var b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
            var b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
            var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
            if (!det) return null;
            det = 1.0 / det;
            var o = new Float32Array(16);
            o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;  o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
            o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;  o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
            o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;  o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
            o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;  o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
            o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;  o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
            o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
            o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
            o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
            return o;
        },
        xform: function (m, x, y, z) {    // returns [x, y, z, w]
            return [
                m[0] * x + m[4] * y + m[8] * z + m[12],
                m[1] * x + m[5] * y + m[9] * z + m[13],
                m[2] * x + m[6] * y + m[10] * z + m[14],
                m[3] * x + m[7] * y + m[11] * z + m[15]
            ];
        }
    };

    // ------------------------------------------------------------------
    // Shaders (GLSL ES 1.00 — runs on WebGL1 and WebGL2)
    // ------------------------------------------------------------------

    // Port of GLShaderSpectrogram::m_vertexShader2. The texture holds dB*100
    // as 16 bit (L = high byte, A = low byte). Grid coordinates are mapped to
    // texel centres, the time axis wraps around the ring buffer with fract()
    // (textureTransform in SDRangel: y' = rot * y + textureOffset).
    var VS_SURFACE = [
        'precision highp float;',
        'attribute vec2 coord2d;',
        'uniform mat4 vertexTransform;',
        'uniform mat3 normalMatrix;',
        'uniform sampler2D dataTexture;',
        'uniform vec2 texSize;',
        'uniform float textureOffset;',
        'uniform float rot;',
        'uniform vec2 levels;',
        'uniform float linMode;',
        'uniform float pointSize;',
        'varying vec3 vCoord;',
        'varying vec3 vNormal;',
        'float heightAt(vec2 tc) {',
        '    vec4 t = texture2D(dataTexture, tc);',
        '    float db = (t.r * 65280.0 + t.a * 255.0) * 0.01 - 200.0;',
        '    if (linMode > 0.5) {',
        '        float p    = pow(10.0, (db - levels.y) * 0.1);',       // power relative to the max level
        '        float pmin = pow(10.0, (levels.x - levels.y) * 0.1);',
        '        return clamp((p - pmin) / max(1.0 - pmin, 0.001), 0.0, 1.0);',
        '    }',
        '    return clamp((db - levels.x) / max(levels.y - levels.x, 0.001), 0.0, 1.0);',
        '}',
        'vec2 tcoord(vec2 c) {',
        '    float u = (c.x * (texSize.x - 1.0) + 0.5) / texSize.x;',
        '    float v = (c.y * (texSize.y - 1.0) + 0.5) / texSize.y;',
        '    return vec2(u, fract(textureOffset + rot * v));',
        '}',
        'void main(void) {',
        '    vec2 tc = tcoord(coord2d);',
        '    float h  = heightAt(tc);',
        '    vec2 d   = 1.0 / texSize;',
        '    float hl = heightAt(vec2(max(tc.x - d.x, 0.0), tc.y));',
        '    float hr = heightAt(vec2(min(tc.x + d.x, 1.0), tc.y));',
        '    float hd = heightAt(vec2(tc.x, fract(tc.y - rot * d.y)));',
        '    float hu = heightAt(vec2(tc.x, fract(tc.y + rot * d.y)));',
        '    vec3 n = vec3(-(hr - hl) * 0.5 * (texSize.x - 1.0), -(hu - hd) * 0.5 * (texSize.y - 1.0), 1.0);',
        '    vNormal = normalize(normalMatrix * n);',
        '    vCoord  = vec3(coord2d, h);',
        '    gl_Position  = vertexTransform * vec4(coord2d, h, 1.0);',
        '    gl_PointSize = pointSize;',
        '}'
    ].join('\n');

    // Port of m_fragmentShaderSimple2 / m_fragmentShaderShaded
    var FS_SURFACE = [
        'precision mediump float;',
        'varying vec3 vCoord;',
        'varying vec3 vNormal;',
        'uniform sampler2D colorMap;',
        'uniform float brightness;',
        'uniform float shaded;',
        'uniform vec3 lightDir;',
        'void main(void) {',
        '    float factor = gl_FrontFacing ? 1.0 : 0.5;',
        '    vec3 color = texture2D(colorMap, vec2(vCoord.z, 0.5)).rgb;',
        '    if (shaded > 0.5) {',
        '        float diff = abs(dot(normalize(vNormal), lightDir));',
        '        color *= (0.30 + 0.70 * diff);',
        '    }',
        '    gl_FragColor = vec4(color * brightness * factor, 1.0);',
        '}'
    ].join('\n');

    var VS_LINE = [
        'precision highp float;',
        'attribute vec3 pos;',
        'uniform mat4 m;',
        'void main(void) { gl_Position = m * vec4(pos, 1.0); }'
    ].join('\n');

    var FS_LINE = [
        'precision mediump float;',
        'uniform vec4 color;',
        'void main(void) { gl_FragColor = vec4(color.rgb * color.a, color.a); }'
    ].join('\n');

    function compileShader(gl, type, src) {
        var sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            var log = gl.getShaderInfoLog(sh);
            gl.deleteShader(sh);
            throw new Error('dnx_3dtool shader error: ' + log);
        }
        return sh;
    }

    function linkProgram(gl, vs, fs) {
        var prog = gl.createProgram();
        gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, vs));
        gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            throw new Error('dnx_3dtool link error: ' + gl.getProgramInfoLog(prog));
        }
        return prog;
    }

    // ------------------------------------------------------------------
    // Spectrogram3D — the GL side (GLShaderSpectrogram)
    // ------------------------------------------------------------------

    function Spectrogram3D(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.cols = 0;
        this.rows = 0;
        this.uint32 = false;
        this.gridReady = false;
        this.texReady = false;
    }

    Spectrogram3D.prototype.initGL = function () {
        var opts = { alpha: true, premultipliedAlpha: true, antialias: true, depth: true,
                     preserveDrawingBuffer: false, powerPreference: 'high-performance' };
        var gl = window.DNX3D_FORCE_WEBGL1 ? null : this.canvas.getContext('webgl2', opts);
        this.isGL2 = !!gl;
        if (!gl) gl = this.canvas.getContext('webgl', opts) || this.canvas.getContext('experimental-webgl', opts);
        if (!gl) throw new Error('WebGL not available');
        this.gl = gl;

        if (gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < 1) {
            throw new Error('GPU does not support vertex texture fetch');
        }
        this.uint32 = this.isGL2 || !!gl.getExtension('OES_element_index_uint');
        this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);

        this.prog = linkProgram(gl, VS_SURFACE, FS_SURFACE);
        this.loc = {
            coord2d:         gl.getAttribLocation(this.prog, 'coord2d'),
            vertexTransform: gl.getUniformLocation(this.prog, 'vertexTransform'),
            normalMatrix:    gl.getUniformLocation(this.prog, 'normalMatrix'),
            dataTexture:     gl.getUniformLocation(this.prog, 'dataTexture'),
            texSize:         gl.getUniformLocation(this.prog, 'texSize'),
            textureOffset:   gl.getUniformLocation(this.prog, 'textureOffset'),
            rot:             gl.getUniformLocation(this.prog, 'rot'),
            levels:          gl.getUniformLocation(this.prog, 'levels'),
            linMode:         gl.getUniformLocation(this.prog, 'linMode'),
            pointSize:       gl.getUniformLocation(this.prog, 'pointSize'),
            colorMap:        gl.getUniformLocation(this.prog, 'colorMap'),
            brightness:      gl.getUniformLocation(this.prog, 'brightness'),
            shaded:          gl.getUniformLocation(this.prog, 'shaded'),
            lightDir:        gl.getUniformLocation(this.prog, 'lightDir')
        };

        this.lineProg = linkProgram(gl, VS_LINE, FS_LINE);
        this.lineLoc = {
            pos:   gl.getAttribLocation(this.lineProg, 'pos'),
            m:     gl.getUniformLocation(this.lineProg, 'm'),
            color: gl.getUniformLocation(this.lineProg, 'color')
        };

        this.vertexBuf = gl.createBuffer();
        this.triBuf    = gl.createBuffer();   // index1Buf in SDRangel (filled surface)
        this.gridBuf   = gl.createBuffer();   // index0Buf in SDRangel (grid lines)
        this.lineBuf   = gl.createBuffer();
        this.dataTex   = gl.createTexture();
        this.cmapTex   = gl.createTexture();

        gl.bindTexture(gl.TEXTURE_2D, this.cmapTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        gl.bindTexture(gl.TEXTURE_2D, this.dataTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

        // static frame: base rectangle, 4 vertical edges, top back edge
        this.frameBuf = gl.createBuffer();
        var f = new Float32Array([
            0, 0, 0, 1, 0, 0,   1, 0, 0, 1, 1, 0,   1, 1, 0, 0, 1, 0,   0, 1, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 1,   1, 0, 0, 1, 0, 1,   1, 1, 0, 1, 1, 1,   0, 1, 0, 0, 1, 1,
            0, 1, 1, 1, 1, 1
        ]);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.frameBuf);
        gl.bufferData(gl.ARRAY_BUFFER, f, gl.STATIC_DRAW);
        this.frameCount = f.length / 3;
    };

    // GLShaderSpectrogram::initGrid — but with exactly cols x rows vertices so
    // that every vertex hits a texel centre (NEAREST sampling, no seam bleed)
    Spectrogram3D.prototype.setGrid = function (cols, rows) {
        var gl = this.gl;
        if (!this.uint32 && cols * rows > 65535) rows = Math.floor(65535 / cols);
        this.cols = cols; this.rows = rows;

        var verts = new Float32Array(cols * rows * 2), p = 0;
        for (var j = 0; j < rows; j++) {
            for (var i = 0; i < cols; i++) {
                verts[p++] = i / (cols - 1);
                verts[p++] = j / (rows - 1);
            }
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuf);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

        var IndexArray = (cols * rows > 65535) ? Uint32Array : Uint16Array;
        this.indexType = (IndexArray === Uint32Array) ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

        // triangles (index1Buf)
        var tri = new IndexArray((cols - 1) * (rows - 1) * 6); p = 0;
        for (var y = 0; y < rows - 1; y++) {
            for (var x = 0; x < cols - 1; x++) {
                var a = y * cols + x;
                tri[p++] = a; tri[p++] = a + 1;        tri[p++] = a + cols + 1;
                tri[p++] = a; tri[p++] = a + cols + 1; tri[p++] = a + cols;
            }
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.triBuf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tri, gl.STATIC_DRAW);
        this.triCount = tri.length;

        // grid lines (index0Buf): all row lines first, then column lines
        var grid = new IndexArray(rows * (cols - 1) * 2 + cols * (rows - 1) * 2); p = 0;
        for (y = 0; y < rows; y++) for (x = 0; x < cols - 1; x++) { grid[p++] = y * cols + x; grid[p++] = y * cols + x + 1; }
        this.rowLineCount = p;
        for (x = 0; x < cols; x++) for (y = 0; y < rows - 1; y++) { grid[p++] = y * cols + x; grid[p++] = (y + 1) * cols + x; }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.gridBuf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, grid, gl.STATIC_DRAW);
        this.gridCount = grid.length;
        this.gridReady = true;
    };

    // GLShaderSpectrogram::initTexture (16 bit dB in LUMINANCE_ALPHA)
    Spectrogram3D.prototype.setTexture = function (cols, rows) {
        var gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.dataTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, cols, rows, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, null);
        this.texCols = cols; this.texRows = rows;
        this.texReady = true;
    };

    // GLShaderSpectrogram::subTexture (one row)
    Spectrogram3D.prototype.uploadRow = function (row, bytes) {
        var gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.dataTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, row, this.texCols, 1, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, bytes);
    };

    // GLShaderSpectrogram::initColorMapTexture — from OpenWebRX Waterfall.colors
    Spectrogram3D.prototype.setColorMap = function (colors) {
        var gl = this.gl, n = colors.length, buf = new Uint8Array(n * 3);
        for (var i = 0; i < n; i++) {
            var c = colors[i];
            buf[i * 3]     = Math.max(0, Math.min(255, Math.round(c[0])));
            buf[i * 3 + 1] = Math.max(0, Math.min(255, Math.round(c[1])));
            buf[i * 3 + 2] = Math.max(0, Math.min(255, Math.round(c[2])));
        }
        gl.bindTexture(gl.TEXTURE_2D, this.cmapTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, n, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, buf);
    };

    // GLShaderSpectrogram::applyTransform / applyPerspective
    //   P * T(0,0,-1.65) * T(user) * Rx * Ry * Rz * S(aspect, 1, sz) * T(-0.5,-0.5,0)
    Spectrogram3D.prototype.computeMatrices = function (view, aspect, sz) {
        var R = M4.mul(M4.mul(M4.rotateX(view.rotX), M4.rotateY(view.rotY)), M4.rotateZ(view.rotZ));
        var plotWidth = Math.max(1, this.canvas.width);
        var waterfallHeight = Math.max(1, this.canvas.height);
        var scaleX = plotWidth / waterfallHeight;
        var histogramHeight = waterfallHeight / 2.0;
        var scaleZ = histogramHeight / plotWidth;
        var userScaleZ = Math.max(0.05, sz / 0.40);
        var m = M4.perspective(view.fov, aspect, 0.1, 7.0);
        m = M4.mul(m, M4.translate(0, 0, -1.65));
        m = M4.mul(m, M4.translate(view.tx, view.ty, view.tz));
        m = M4.mul(m, R);
        m = M4.mul(m, M4.scale(scaleX, 1, scaleZ * userScaleZ));
        m = M4.mul(m, M4.translate(-0.5, -0.5, 0));

        // normal matrix = R * S^-1 (rotation is orthonormal)
        var N = M4.mul(R, M4.scale(1 / scaleX, 1, 1 / Math.max(scaleZ * userScaleZ, 1e-6)));
        var n3 = new Float32Array([N[0], N[1], N[2], N[4], N[5], N[6], N[8], N[9], N[10]]);

        // light direction in view space (towards the light)
        var L = M4.xform(M4.mul(M4.rotateY(view.lightAz), M4.rotateX(view.lightEl)), 0, 0, 1);
        var ll = Math.hypot(L[0], L[1], L[2]) || 1;
        return { mvp: m, normal: n3, light: [L[0] / ll, L[1] / ll, L[2] / ll] };
    };

    Spectrogram3D.prototype.project = function (mvp, x, y, z, w, h) {
        var p = M4.xform(mvp, x, y, z);
        if (p[3] <= 0.0001) return null;
        return [(p[0] / p[3] * 0.5 + 0.5) * w, (0.5 - p[1] / p[3] * 0.5) * h];
    };

    // screen -> grid coordinates on the z = 0 plane
    Spectrogram3D.prototype.unproject = function (mvp, px, py, w, h) {
        var inv = M4.invert(mvp);
        if (!inv) return null;
        var nx = px / w * 2 - 1, ny = 1 - py / h * 2;
        var a = M4.xform(inv, nx, ny, -1), b = M4.xform(inv, nx, ny, 1);
        if (!a[3] || !b[3]) return null;
        for (var i = 0; i < 3; i++) { a[i] /= a[3]; b[i] /= b[3]; }
        var dz = b[2] - a[2];
        if (Math.abs(dz) < 1e-9) return null;
        var t = -a[2] / dz;
        return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    };

    // GLShaderSpectrogram::drawSurface
    Spectrogram3D.prototype.render = function (st) {
        var gl = this.gl, loc = this.loc;
        var w = this.canvas.width, h = this.canvas.height;
        gl.viewport(0, 0, w, h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        if (!this.gridReady || !this.texReady) return;

        gl.useProgram(this.prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuf);
        gl.enableVertexAttribArray(loc.coord2d);
        gl.vertexAttribPointer(loc.coord2d, 2, gl.FLOAT, false, 0, 0);

        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.dataTex);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.cmapTex);
        gl.uniform1i(loc.dataTexture, 0);
        gl.uniform1i(loc.colorMap, 1);
        gl.uniformMatrix4fv(loc.vertexTransform, false, st.mvp);
        gl.uniformMatrix3fv(loc.normalMatrix, false, st.normal);
        gl.uniform2f(loc.texSize, this.texCols, this.texRows);
        gl.uniform1f(loc.textureOffset, st.textureOffset);
        gl.uniform1f(loc.rot, st.rot);
        gl.uniform2f(loc.levels, st.levelMin, st.levelMax);
        gl.uniform1f(loc.linMode, st.linear ? 1.0 : 0.0);
        gl.uniform1f(loc.pointSize, Math.max(1, Math.round(st.dpr * 1.5)));
        gl.uniform3fv(loc.lightDir, st.light);
        gl.uniform1f(loc.shaded, st.style === 'shaded' ? 1 : 0);
        gl.uniform1f(loc.brightness, 1.0);

        gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);

        var self = this;
        function fill(brightness) {
            gl.uniform1f(loc.brightness, brightness);
            gl.enable(gl.POLYGON_OFFSET_FILL);
            gl.polygonOffset(1.0, 1.0);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, self.triBuf);
            gl.drawElements(gl.TRIANGLES, self.triCount, self.indexType, 0);
            gl.disable(gl.POLYGON_OFFSET_FILL);
        }
        function lines(brightness, count) {
            gl.uniform1f(loc.brightness, brightness);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, self.gridBuf);
            gl.drawElements(gl.LINES, count, self.indexType, 0);
        }

        switch (st.style) {
            case 'points':
                gl.drawArrays(gl.POINTS, 0, this.cols * this.rows);
                break;
            case 'lines':
                lines(1.0, this.gridCount);
                break;
            case 'traces':                       // hidden-line frequency sweeps
                fill(0.0);
                lines(1.2, this.rowLineCount);
                break;
            case 'solid':
            case 'shaded':
                fill(1.0);
                break;
            case 'outline':
            default:                             // SDRangel: darken fill, brighten grid
                fill(0.85);
                lines(1.5, this.gridCount);
                break;
        }
        gl.disableVertexAttribArray(loc.coord2d);

        // ---- frame + tuning marker (translucent, drawn last) ----
        gl.useProgram(this.lineProg);
        gl.uniformMatrix4fv(this.lineLoc.m, false, st.mvp);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.enableVertexAttribArray(this.lineLoc.pos);

        if (st.showFrame) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.frameBuf);
            gl.vertexAttribPointer(this.lineLoc.pos, 3, gl.FLOAT, false, 0, 0);
            gl.uniform4f(this.lineLoc.color, 1, 1, 1, 0.28);
            gl.drawArrays(gl.LINES, 0, this.frameCount);
        }

        if (st.marker) {
            var mk = st.marker, yN = st.rot < 0 ? 0 : 1;   // newest edge
            gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
            gl.vertexAttribPointer(this.lineLoc.pos, 3, gl.FLOAT, false, 0, 0);
            function plane(x, col) {
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x, 0, 0, x, 1, 0, x, 0, 1, x, 1, 1]), gl.DYNAMIC_DRAW);
                gl.uniform4fv(self.lineLoc.color, col);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            }
            if (mk.lo !== null && mk.hi !== null && mk.hi > mk.lo) {
                plane(mk.lo, [1, 1, 0.6, 0.08]);
                plane(mk.hi, [1, 1, 0.6, 0.08]);
                gl.disable(gl.DEPTH_TEST);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([mk.lo, yN, 0, mk.hi, yN, 0]), gl.DYNAMIC_DRAW);
                gl.uniform4f(this.lineLoc.color, 1, 1, 0.4, 0.9);
                gl.drawArrays(gl.LINES, 0, 2);
                gl.enable(gl.DEPTH_TEST);
            }
            plane(mk.x, [1, 0.95, 0.2, 0.18]);
            gl.disable(gl.DEPTH_TEST);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([mk.x, yN, 0, mk.x, yN, 1.08]), gl.DYNAMIC_DRAW);
            gl.uniform4f(this.lineLoc.color, 1, 0.9, 0.1, 0.95);
            gl.drawArrays(gl.LINES, 0, 2);
        }
        gl.disableVertexAttribArray(this.lineLoc.pos);
        gl.depthMask(true);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
    };

    // ------------------------------------------------------------------
    // Data path (GLSpectrumView::update3DSpectrogram)
    // ------------------------------------------------------------------

    // Decimate one history row (Int16 dB*100) of `n` bins, visible range
    // [b0, b1) (fractional bins) into `cols` texels (max-hold, or linear
    // interpolation when zoomed in far enough that a texel covers < 1 bin)
    function decimateRow(src, off, n, b0, b1, cols, dst) {
        var span = (b1 - b0) / cols, c, u, m;
        if (span >= 1) {
            var x0 = b0;
            for (c = 0; c < cols; c++) {
                var x1 = b0 + (c + 1) * span;
                var i0 = Math.floor(x0), i1 = Math.floor(x1);
                if (i1 <= i0) i1 = i0 + 1;
                if (i0 < 0) i0 = 0;
                if (i1 > n) i1 = n;
                m = -32768;
                for (var i = i0; i < i1; i++) { var v = src[off + i]; if (v > m) m = v; }
                u = m + 20000; if (u < 0) u = 0; else if (u > 65535) u = 65535;
                dst[2 * c] = u >> 8; dst[2 * c + 1] = u & 255;
                x0 = x1;
            }
        } else {
            for (c = 0; c < cols; c++) {
                var x = b0 + (c + 0.5) * span - 0.5;
                var k = Math.floor(x), f = x - k;
                var k0 = Math.max(0, Math.min(n - 1, k)), k1 = Math.max(0, Math.min(n - 1, k + 1));
                m = src[off + k0] + (src[off + k1] - src[off + k0]) * f;
                u = Math.round(m) + 20000; if (u < 0) u = 0; else if (u > 65535) u = 65535;
                dst[2 * c] = u >> 8; dst[2 * c + 1] = u & 255;
            }
        }
    }

    function fmtFreq(f) {
        if (!isFinite(f)) return '';
        if (Math.abs(f) >= 1e9) return (f / 1e9).toFixed(4) + ' GHz';
        if (Math.abs(f) >= 1e6) return (f / 1e6).toFixed(f >= 1e8 ? 3 : 4) + ' MHz';
        return (f / 1e3).toFixed(1) + ' kHz';
    }

    function fmtTime(sec) {
        if (!isFinite(sec) || sec <= 0) return '';
        if (sec < 90) return '-' + Math.round(sec) + ' s';
        var m = Math.floor(sec / 60), s = Math.round(sec - m * 60);
        return '-' + m + ':' + (s < 10 ? '0' : '') + s + ' min';
    }

    // ------------------------------------------------------------------
    // Plugin controller
    // ------------------------------------------------------------------

    P.settings = null;
    P.view = null;
    P.gl3d = null;
    P._on = false;
    P._hist = null;          // Int16Array rows*fftSize (dB * 100), ring buffer
    P._fftSize = 0;
    P._rows = 0;
    P._pos = 0;              // next row to write (== texture row, textureOffset = pos/rows)
    P._filled = 0;
    P._rowBytes = null;
    P._rebuild = true;
    P._range = { b0: -1, b1: -1 };
    P._lastLine = 0;
    P._interval = 0;         // seconds between lines (EMA)
    P._lastColors = null;
    P._cmapName = null;      // colour map currently uploaded to the GPU
    P._paused = false;
    P._avg = { type: 'no', n: 1, acc: null, out: null, cnt: 0 };
    P._dirty = true;
    P._newData = false;
    P._lastDraw = 0;
    P._lastRebuild = 0;
    P._raf = 0;
    P._mvp = null;
    P._hover = false;

    P.init = function () {
        this.settings = loadSettings();
        if (typeof this.settings.smooth !== 'boolean') this.settings.smooth = true;
        this.settings.rows = Math.max(256, this.settings.rows || 256);
        this.view = this.settings.view;

        // SDRangel-Grundstellung: keine alte gespeicherte Z-Drehung
        // darf die Frequenzrippen diagonal über die Fläche drehen.
        this.view.rotX = -45;
        this.view.rotY = 0;
        this.view.rotZ = 0;
        this.view.tx = 0;
        this.view.ty = 0;
        this.view.tz = 0;
        this.view.fov = 45;

        if (!document.getElementById('webrx-canvas-background')) {
            console.error('dnx_3dtool: waterfall container not found');
            return false;
        }
        if (!this._hook()) {
            console.error('dnx_3dtool: waterfall_add() not found — is this OpenWebRX+?');
            return false;
        }
        this._buildUI();
        try { this._registerWfThemes(); } catch (e) { console.warn('dnx_3dtool: theme registration failed', e); }
        // Restore the selected 2D / 3D / split view after a reload.
        this.setMode(this.settings.enabled ? (this.settings.viewMode === 'std' ? '3d' : this.settings.viewMode) : 'std', true);
        console.info('dnx_3dtool: 3D waterfall plugin v' + P._version + ' ready');
        return true;
    };

    // allow overriding defaults from init.js:
    //   Plugins.load('dnx_3dtool').then(function(){ Plugins.dnx_3dtool.configure({style:'shaded', colormap:'Turbo', avgType:'mov', avgN:5}); });
    P.configure = function (opts) {
        for (var k in opts) {
            if (k === 'view') { for (var v in opts.view) this.view[v] = opts.view[v]; }
            else this.settings[k] = opts[k];
        }
        this._applySettings();
        saveSettings(this.settings);
    };

    // ---- hooks -------------------------------------------------------

    P._hook = function () {
        var self = this;
        if (typeof window.waterfall_add !== 'function') return false;
        if (!window.waterfall_add.__dnx3d) {
            var orig = window.waterfall_add;
            var wrapped = function (data) {
                var r = orig.apply(this, arguments);
                try { self.addLine(data); } catch (e) { console.error('dnx_3dtool:', e); }
                return r;
            };
            wrapped.__dnx3d = true;
            window.waterfall_add = wrapped;
        }
        if (typeof window.waterfall_clear === 'function' && !window.waterfall_clear.__dnx3d) {
            var origClear = window.waterfall_clear;
            var wrappedClear = function () {
                var r = origClear.apply(this, arguments);
                try { self.clearHistory(); } catch (e) { /* ignore */ }
                return r;
            };
            wrappedClear.__dnx3d = true;
            window.waterfall_clear = wrappedClear;
        }
        return true;
    };

    // ---- UI ----------------------------------------------------------

    P._buildUI = function () {
        var self = this;
        var $bg = $('#webrx-canvas-background');

        var $wrap = $(
            '<div id="dnx3d-wrap" style="display:none;">' +
            '  <canvas id="dnx3d-canvas"></canvas>' +
            '  <div id="dnx3d-labels">' +
            '    <span id="dnx3d-lbl-f0"></span><span id="dnx3d-lbl-f1"></span>' +
            '    <span id="dnx3d-lbl-now">now</span><span id="dnx3d-lbl-old"></span>' +
            '  </div>' +
            '  <div id="dnx3d-freqscale"></div>' +
            '  <div id="dnx3d-toolbar">' +
            '    <span class="dnx3d-title" title="dnx_3dtool v' + P._version + ' — SDRangel style 3D spectrogram">3D</span>' +
            '    <select id="dnx3d-style" title="3D spectrogram style: Points / Lines / Traces / Solid / Outline / Shaded">' +
            '      <option value="points">Points</option><option value="lines">Lines</option>' +
            '      <option value="traces">Traces</option><option value="solid">Solid</option>' +
            '      <option value="outline">Outline</option><option value="shaded">Shaded</option>' +
            '    </select>' +
            '    <select id="dnx3d-cmap" title="Colour map of the 3D surface: OpenWebRX waterfall theme or a SDRangel colour map"></select>' +
            '    <span class="dnx3d-sep"></span>' +
            '    <select id="dnx3d-avg" title="Averaging: No averaging / Moving average / Fixed average (one line per N) / Max hold (one line per N)">' +
            '      <option value="no">No</option><option value="mov">Mov</option>' +
            '      <option value="fix">Fix</option><option value="max">Max</option>' +
            '    </select>' +
            '    <select id="dnx3d-avgn" title="Number of FFT lines to average (Mov / Fix / Max)">' +
            '      <option value="1">1</option><option value="2">2</option><option value="5">5</option>' +
            '      <option value="10">10</option><option value="20">20</option><option value="50">50</option>' +
            '      <option value="100">100</option><option value="200">200</option>' +
            '    </select>' +
            '    <span class="dnx3d-sep"></span>' +
            '    <select id="dnx3d-fps" title="Maximum number of 3D frames per second">' +
            '      <option value="5">5 fps</option><option value="10">10 fps</option><option value="15">15 fps</option>' +
            '      <option value="20">20 fps</option><option value="30">30 fps</option><option value="60">60 fps</option>' +
            '    </select>' +
            '    <button id="dnx3d-lin" title="Height scale: Log (dB between the waterfall min/max levels) or Lin (linear power, 0 .. max level — put the max level close to the signal peaks)">Lin</button>' +
            '    <span class="dnx3d-sep"></span>' +
            '    <select id="dnx3d-rows" title="History depth (FFT lines kept in the 3D view)">' +
            '      <option value="128">128</option><option value="256">256</option>' +
            '      <option value="512">512</option><option value="1024">1024</option>' +
            '    </select>' +
            '    <span class="dnx3d-field-label">FFT size</span>' +
            '    <select id="dnx3d-cols" title="Frequency resolution of the mesh (columns)">' +
            '      <option value="64">64</option>' +
            '      <option value="128">128</option>' +
            '      <option value="256">256</option>' +
            '      <option value="512">512</option>' +
            '      <option value="1024">1k</option>' +
            '      <option value="2048">2k</option>' +
            '      <option value="4096">4k</option>' +
            '      <option value="8192">8k</option>' +
            '      <option value="16384">16k</option>' +
            '      <option value="32768">32k</option>' +
            '    </select>' +
            '    <button id="dnx3d-smooth" title="Glättung und Pixeldichte umschalten">Smooth</button>' +
            '    <input id="dnx3d-height" type="range" min="0" max="5" step="0.05" title="Height scale (also right-drag / Ctrl and +/-)">' +
            '    <span class="dnx3d-sep"></span>' +
            '    <button id="dnx3d-flip" title="Zeit-Richtung umkehren: neueste Zeile oben/unten (down/up)">&#8645;</button>' +
            '    <button id="dnx3d-frame" title="Show frame, tuning marker and labels">&#9633;</button>' +
            '    <button id="dnx3d-pause" title="Pause / resume the 3D spectrogram">&#10074;&#10074;</button>' +
            '    <button id="dnx3d-save" title="Save the 3D view as PNG image">PNG</button>' +
            '    <button id="dnx3d-reset" title="Reset view (R)">&#8634;</button>' +
            '    <button id="dnx3d-close" title="Back to the 2D waterfall">&#10005;</button>' +
            '  </div>' +
            '  <div id="dnx3d-msg"></div>' +
            '</div>');
        $bg.append($wrap);
        this.$wrap = $wrap;
        this.canvas = $wrap.find('#dnx3d-canvas')[0];

        // Always-visible view selector: the 3D toolbar is hidden in STD mode,
        // so the user must still be able to choose STD / 3D / BOTH and swap
        // the two panes without relying on the old inline Std/3DM block.
        var $modebar = $(
            '<div id="dnx3d-modebar" title="Ansicht: 2D-Wasserfall, 3D oder beide; Pfeil tauscht oben und unten">' +
            '  <span>Ansicht</span>' +
            '  <button data-mode="std">STD</button>' +
            '  <button data-mode="3d">3D</button>' +
            '  <button data-mode="both">BEIDE</button>' +
            '  <button id="dnx3d-splitflip" title="Im gemeinsamen Bild 2D und 3D oben/unten tauschen">&#8645;</button>' +
            '</div>');
        $bg.append($modebar);
        this.$modebar = $modebar;

        // Ansicht-Auswahl immer rechts unten halten.
        var modebarNode = $modebar[0];
        modebarNode.style.setProperty('position', 'fixed', 'important');
        modebarNode.style.setProperty('left', 'auto', 'important');
        modebarNode.style.setProperty('right', '8px', 'important');
        modebarNode.style.setProperty('top', 'auto', 'important');
        modebarNode.style.setProperty('bottom', '8px', 'important');
        modebarNode.style.setProperty('z-index', '2147483647', 'important');
        $modebar.find('button[data-mode]').on('click', function () { self.setMode($(this).data('mode')); });
        $modebar.find('#dnx3d-splitflip').on('click', function () {
            self.settings.splitFlip = !self.settings.splitFlip;
            self._save();
            self._layoutMode();
        });

        // colour map list: OpenWebRX theme + SDRangel maps
        var $cm = $wrap.find('#dnx3d-cmap');
        $cm.append($('<option>').val('owrx').text('Waterfall'));   // follow the OpenWebRX waterfall theme
        SDR_NAMES.forEach(function (name) { $cm.append($('<option>').val(name).text(name)); });

        $wrap.find('#dnx3d-style').on('change', function () { self.settings.style = this.value; self._save(); self._dirty = true; });
        $cm.on('change', function () { self.settings.colormap = this.value; self._save(); self._dirty = true; });
        $wrap.find('#dnx3d-avg').on('change', function () { self.settings.avgType = this.value; self._save(); });
        $wrap.find('#dnx3d-avgn').on('change', function () { self.settings.avgN = parseInt(this.value); self._save(); });
        $wrap.find('#dnx3d-fps').on('change', function () { self.settings.fps = parseInt(this.value); self._save(); });
        $wrap.find('#dnx3d-lin').on('click', function () { self.settings.linear = !self.settings.linear; self._save(); self._applySettings(); });
        $wrap.find('#dnx3d-pause').on('click', function () { self.setPaused(!self._paused); });
        $wrap.find('#dnx3d-save').on('click', function () { self.savePNG(); });
        $wrap.find('#dnx3d-rows').on('change', function () { self.settings.rows = parseInt(this.value); self._save(); self._reallocAll(); });
        $wrap.find('#dnx3d-cols').on('change', function () { self.settings.cols = parseInt(this.value); self._save(); self._reallocGL(); });
        $wrap.find('#dnx3d-smooth').on('click', function () { self._toggleSmooth(); });
        $wrap.find('#dnx3d-height').on('input', function () { self.settings.heightScale = parseFloat(this.value); self._dirty = true; })
                                    .on('change', function () { self._save(); });
        $wrap.find('#dnx3d-flip').on('click', function () { self.settings.invert = !self.settings.invert; self._save(); self._applySettings(); });
        $wrap.find('#dnx3d-frame').on('click', function () {
            var on = !(self.settings.showFrame || self.settings.showLabels);
            self.settings.showFrame = self.settings.showLabels = self.settings.showMarker = on;
            self._save(); self._applySettings();
        });
        $wrap.find('#dnx3d-reset').on('click', function () { self.resetView(); });
        $wrap.find('#dnx3d-close').on('click', function () { self.disable(); });
        // keep toolbar interaction away from the 3D mouse handlers
        $wrap.find('#dnx3d-toolbar').on('mousedown touchstart wheel', function (e) { e.stopPropagation(); });

        // toggle button: receiver panel plugin stack (newer OWRX+) or the zoom button bar
        if (typeof Plugins.addButton === 'function' && $('#openwebrx-panel-plugins').length) {
            this.button = Plugins.addButton('dnx_3dtool', '3D', function () { self.toggle(); });
        } else {
            var $b = $('<div class="openwebrx-button openwebrx-square-button openwebrx-zoom-button" id="dnx3d-button" title="3D waterfall">3D</div>');
            $b.on('click', function () { self.toggle(); });
            var $last = $('.openwebrx-zoom-button').last();
            if ($last.length) $last.after($b); else $('#openwebrx-panel-receiver').append($b);
            this.button = $b[0];
        }

        this._bindInput();
        this._applySettings();
    };

    P._applySettings = function () {
        var s = this.settings, $w = this.$wrap;
        $w.find('#dnx3d-style').val(s.style);
        $w.find('#dnx3d-cmap').val((s.colormap && SDR_MAPS[s.colormap]) ? s.colormap : 'owrx');
        $w.find('#dnx3d-avg').val(s.avgType);
        if (!$w.find('#dnx3d-avgn option[value="' + s.avgN + '"]').length) {
            $w.find('#dnx3d-avgn').append($('<option>').val(s.avgN).text(s.avgN));
        }
        $w.find('#dnx3d-avgn').val(String(s.avgN));
        if (!$w.find('#dnx3d-fps option[value="' + s.fps + '"]').length) {
            $w.find('#dnx3d-fps').append($('<option>').val(s.fps).text(s.fps + ' fps'));
        }
        $w.find('#dnx3d-fps').val(String(s.fps));
        $w.find('#dnx3d-lin').toggleClass('active', !!s.linear);
        $w.find('#dnx3d-rows').val(String(s.rows));
        $w.find('#dnx3d-cols').val(String(s.cols));
        $w.find('#dnx3d-height').val(s.heightScale);
        $w.find('#dnx3d-flip').toggleClass('active', !!s.invert);
        $w.find('#dnx3d-frame').toggleClass('active', !!(s.showFrame || s.showLabels));
        $w.find('#dnx3d-labels').toggle(!!s.showLabels);
        this.canvas.style.background = 'rgba(0,0,0,' + s.backdrop + ')';
        if (this._rows !== s.rows) this._reallocAll();
        else if (this.gl3d && this.gl3d.cols !== s.cols) this._reallocGL();
        this._dirty = true;
        this._layoutMode();
    };

    P._layoutMode = function () {
        if (!this.$modebar) return;
        var mode = this.settings.viewMode || 'std';
        this.$modebar.find('button[data-mode]').each(function () {
            $(this).toggleClass('active', $(this).data('mode') === mode);
        });
        this.$modebar.find('#dnx3d-splitflip').toggleClass('active', !!this.settings.splitFlip);
        var $bg = $('#webrx-canvas-background');
        $bg.toggleClass('dnx3d-split', mode === 'both');
        $bg.toggleClass('dnx3d-split-flip', mode === 'both' && !!this.settings.splitFlip);
        var $c2 = $('#webrx-canvas-container');
        if (mode === '3d') $c2.hide(); else $c2.show();
        if (mode === 'std') this.$wrap.hide(); else this.$wrap.show();
        this._onResize();
    };

    P._save = function () { saveSettings(this.settings); };

    P._msg = function (text) { this.$wrap.find('#dnx3d-msg').text(text || '').toggle(!!text); };

    // ---- pause / save / OpenWebRX theme list --------------------------

    P.setPaused = function (on) {
        this._paused = !!on;
        this.$wrap.find('#dnx3d-pause').toggleClass('active', this._paused).html(this._paused ? '&#9654;' : '&#10074;&#10074;');
        this._msg(this._paused ? 'paused' : '');
        this._dirty = true;
    };

    // GLSpectrumGUI "Save spectrum data": here the rendered 3D view as PNG
    P.savePNG = function () {
        if (!this.gl3d || !this._on || this._glLost) return;
        this._dirty = true;
        this._frame(performance.now());          // fresh frame; toDataURL must follow in the same task
        var url;
        try { url = this.canvas.toDataURL('image/png'); } catch (e) { console.error('dnx_3dtool:', e); return; }
        var a = document.createElement('a');
        a.href = url;
        a.download = 'owrx-3d-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.png';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { a.remove(); }, 0);
    };

    // register the SDRangel colour maps as additional OpenWebRX waterfall themes
    // (UI.wfThemes + #openwebrx-wf-themes-listbox), so they can be used in 2D too
    P._registerWfThemes = function () {
        if (!window.UI || !UI.wfThemes) return;
        var $lb = $('#openwebrx-wf-themes-listbox');
        SDR_NAMES.forEach(function (name) {
            var key = 'sdrangel_' + name.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (key in UI.wfThemes) return;
            UI.wfThemes[key] = expandMap(name).map(function (c) { return (c[0] << 16) | (c[1] << 8) | c[2]; });
            if ($lb.length) $lb.append($('<option>').val(key).text('SDRangel ' + name));
        });
    };

    // ---- enable / disable / view modes -------------------------------

    P._start3d = function () {
        if (this._on) return;
        if (!this.gl3d) {
            try {
                this.gl3d = new Spectrogram3D(this.canvas);
                this.gl3d.initGL();
            } catch (e) {
                console.error('dnx_3dtool:', e);
                this.gl3d = null;
                this._on = true;
                this.$wrap.show();
                this._msg('3D waterfall not available: ' + e.message);
                var me = this;
                setTimeout(function () { me.setMode('std'); }, 4000);
                return;
            }
            var self0 = this;
            this.canvas.addEventListener('webglcontextlost', function (e) {
                e.preventDefault();
                self0._glLost = true;
                console.warn('dnx_3dtool: WebGL context lost');
            });
            this.canvas.addEventListener('webglcontextrestored', function () {
                self0._glLost = false;
                try {
                    self0.gl3d.initGL();
                    self0._lastColors = null; self0._cmapName = null;
                    self0._reallocGL();
                    console.info('dnx_3dtool: WebGL context restored');
                } catch (err) { console.error('dnx_3dtool:', err); }
            });
            this._reallocGL();
        }
        this._on = true;
        this.$wrap.show();
        $(this.button).addClass('highlighted');
        this._msg(this._filled ? '' : 'waiting for FFT data…');
        this._onResize();
        this._rebuild = true; this._dirty = true;
        var self = this;
        if (!this._ro && window.ResizeObserver) {
            this._ro = new ResizeObserver(function () { self._onResize(); });
            this._ro.observe(this.$wrap[0]);
        }
        $(window).on('resize.dnx3d', function () { self._onResize(); });
        this._loop();
    };

    P._stop3d = function () {
        if (!this._on) return;
        this._on = false;
        this.$wrap.hide();
        $(this.button).removeClass('highlighted');
        $(window).off('resize.dnx3d');
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    };

    P.setMode = function (mode, restoring) {
        mode = (mode === '3d' || mode === 'both') ? mode : 'std';
        this.settings.viewMode = mode;
        this.settings.enabled = mode !== 'std';
        if (mode !== 'std') this._start3d(); else this._stop3d();
        this._layoutMode();
        if (!restoring) this._save();
    };

    P.enable = function () { this.setMode('3d'); };
    P.disable = function () { this.setMode('std'); };
    P.toggle = function () { this.setMode(this.settings.viewMode === '3d' ? 'std' : '3d'); };

    P.resetView = function () {
        var d = DEFAULTS.view;
        for (var k in d) this.view[k] = d[k];
        this.settings.heightScale = 1.0;
        this.$wrap.find('#dnx3d-height').val(1.0);
        this._save(); this._dirty = true;
    };

    // ---- buffers -----------------------------------------------------

    P._reallocAll = function () {
        var rows = this.settings.rows;
        // cap memory: history Int16 <= ~32 MB
        if (this._fftSize) rows = Math.min(rows, Math.max(64, Math.floor(16 * 1024 * 1024 / this._fftSize)));
        this._rows = rows;
        this._hist = this._fftSize ? new Int16Array(this._fftSize * rows) : null;
        if (this._hist) this._hist.fill(-32768);
        this._pos = 0; this._filled = 0;
        this._reallocGL();
    };

    P._applyTextureFilter = function () {
        var g = this.gl3d;
        if (!g || !g.gl || !g.dataTex) return;

        var gl = g.gl;
        var filter = this.settings.smooth === false ? gl.NEAREST : gl.LINEAR;

        gl.bindTexture(gl.TEXTURE_2D, g.dataTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    };

    P._toggleSmooth = function () {
        this.settings.smooth = this.settings.smooth === false;

        // Glatt = mehr Historienzeilen; Pixel = gröbere Darstellung.
        this.settings.rows = this.settings.smooth ? 256 : 128;

        this._reallocAll();
        this._applyTextureFilter();

        var label = this.settings.smooth ? 'Smooth' : 'Pixel';
        (this.$toolbar || this.$wrap)
            .find('#dnx3d-smooth')
            .text(label)
            .toggleClass('active', this.settings.smooth);

        this._save();
        this._dirty = true;
    };

    P._reallocGL = function () {
        if (!this.gl3d || !this._rows || this._glLost) return;
        var cols = Math.min(this.settings.cols, this.gl3d.maxTex);
        this.gl3d.setGrid(cols, Math.min(this._rows, this.gl3d.maxTex));
        if (this.gl3d.rows !== this._rows) {
            // GPU limits (no 32 bit indices / max texture size): shrink history to match
            this._rows = this.gl3d.rows;
            this._hist = this._fftSize ? new Int16Array(this._fftSize * this._rows) : null;
            if (this._hist) this._hist.fill(-32768);
            this._pos = 0; this._filled = 0;
        }
        this.gl3d.setTexture(this.gl3d.cols, this.gl3d.rows);
        this._applyTextureFilter();
        this._rowBytes = new Uint8Array(this.gl3d.cols * 2);
        this._rebuild = true; this._dirty = true;
    };

    P.clearHistory = function () {
        if (this._hist) this._hist.fill(-32768);
        this._pos = 0; this._filled = 0;
        this._rebuild = true; this._dirty = true;
    };

    // ---- visible range (follows the OpenWebRX zoom, like Spectrum.js) ----

    P._visibleBins = function () {
        var n = this._fftSize;
        if (typeof get_visible_freq_range !== 'function' || !window.bandwidth || !n) {
            return { b0: 0, b1: n, f0: 0, f1: 0 };
        }
        var vis = get_visible_freq_range();
        if (!vis) return { b0: 0, b1: n, f0: 0, f1: 0 };
        var vs = 0.5 - (center_freq - vis.start) / bandwidth;
        var ve = 0.5 - (center_freq - vis.end) / bandwidth;
        return { b0: vs * n, b1: ve * n, f0: vis.start, f1: vis.end };
    };

    // ---- data input --------------------------------------------------

    // SDRangel averaging (GLSpectrum "Avg" control): No / Mov / Fix / Max.
    // Mov and Fix average linear power (like SDRangel), Max is a max hold.
    // Fix and Max emit one line per N input lines, Mov emits every line.
    P._average = function (data) {
        var t = this.settings.avgType, N = Math.max(1, this.settings.avgN | 0), n = data.length, a = this._avg, i;
        if (t !== 'mov' && t !== 'fix' && t !== 'max') return data;
        if (N <= 1) return data;
        if (!a.acc || a.acc.length !== n || a.type !== t || a.n !== N) {
            a.acc = new Float32Array(n); a.out = new Float32Array(n); a.cnt = 0; a.type = t; a.n = N;
            if (t === 'max') a.acc.fill(-1e9);
        }
        var acc = a.acc, out = a.out;
        if (t === 'mov') {
            a.cnt = Math.min(a.cnt + 1, N);
            var k = 1 / a.cnt;                   // exponential moving average, alpha = 1/N after warm-up
            for (i = 0; i < n; i++) acc[i] += (Math.exp(data[i] * 0.230258509) - acc[i]) * k;
            for (i = 0; i < n; i++) out[i] = 4.342944819 * Math.log(acc[i] > 1e-30 ? acc[i] : 1e-30);
            return out;
        }
        if (t === 'fix') {
            for (i = 0; i < n; i++) acc[i] += Math.exp(data[i] * 0.230258509);
            if (++a.cnt < N) return null;
            for (i = 0; i < n; i++) { out[i] = 4.342944819 * Math.log(acc[i] > 1e-30 ? acc[i] / N : 1e-30); acc[i] = 0; }
            a.cnt = 0;
            return out;
        }
        // max hold
        for (i = 0; i < n; i++) if (data[i] > acc[i]) acc[i] = data[i];
        if (++a.cnt < N) return null;
        for (i = 0; i < n; i++) { out[i] = acc[i]; acc[i] = -1e9; }
        a.cnt = 0;
        return out;
    };

    P.addLine = function (data) {
        var n = data.length;
        if (!n || this._paused) return;
        if (n !== this._fftSize) {
            this._fftSize = n;
            this._reallocAll();
        }
        data = this._average(data);
        if (!data) return;                       // Fix / Max: block not complete yet
        var now = performance.now();
        if (this._lastLine) {
            var dt = (now - this._lastLine) / 1000;
            if (dt < 5) this._interval = this._interval ? this._interval * 0.9 + dt * 0.1 : dt;
        }
        this._lastLine = now;

        // store full resolution dB*100 into the history ring
        var off = this._pos * n, h = this._hist;
        for (var i = 0; i < n; i++) {
            var v = Math.round(data[i] * 100);
            h[off + i] = v < -32768 ? -32768 : (v > 32767 ? 32767 : v);
        }

        // decimate the visible range straight into the texture row
        if (this._on && this.gl3d && this.gl3d.texReady && !this._rebuild && !this._glLost) {
            var r = this._range;
            decimateRow(h, off, n, r.b0, r.b1, this.gl3d.cols, this._rowBytes);
            this.gl3d.uploadRow(this._pos % this.gl3d.rows, this._rowBytes);
        }

        this._pos = (this._pos + 1) % this._rows;
        if (this._filled < this._rows) this._filled++;
        this._newData = true;
    };

    // GLSpectrumView::redrawWaterfallAnd3DSpectrogram — rebuild the whole
    // texture from history (zoom change, resolution change, (re)enable)
    P._rebuildTexture = function () {
        var g = this.gl3d;
        if (!g || !g.texReady || !this._hist) return;
        var n = this._fftSize, r = this._range;
        for (var row = 0; row < g.rows; row++) {
            decimateRow(this._hist, row * n, n, r.b0, r.b1, g.cols, this._rowBytes);
            g.uploadRow(row, this._rowBytes);
        }
        this._rebuild = false;
    };

    // ---- render loop -------------------------------------------------

    P._onResize = function () {
        if (!this.canvas) return;
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var w = Math.max(1, Math.round(this.$wrap[0].clientWidth * dpr));
        var h = Math.max(1, Math.round(this.$wrap[0].clientHeight * dpr));
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w; this.canvas.height = h;
        }
        this._dpr = dpr;
        this._dirty = true;
    };

    P._loop = function () {
        var self = this;
        if (!this._on) return;
        this._raf = requestAnimationFrame(function () { self._loop(); });
        var now = performance.now();
        if (now - this._lastDraw < 1000 / Math.max(1, this.settings.fps)) return;
        if (!this.gl3d || this._glLost) return;
        this._frame(now);
    };

    P._frame = function (now) {
        var g = this.gl3d, s = this.settings;
        if (!this._fftSize) { this._msg('waiting for FFT data…'); return; }
        if (this._filled && !this._paused && this.$wrap.find('#dnx3d-msg').is(':visible')) this._msg('');

        // colour map: SDRangel map or follow the OpenWebRX waterfall theme
        var cm = s.colormap;
        if (cm && cm !== 'owrx' && SDR_MAPS[cm]) {
            if (this._cmapName !== cm) {
                g.setColorMap(expandMap(cm));
                this._cmapName = cm; this._lastColors = null; this._dirty = true;
            }
        } else if (window.Waterfall && (Waterfall.colors !== this._lastColors || this._cmapName !== 'owrx')) {
            g.setColorMap(Waterfall.colors);
            this._lastColors = Waterfall.colors; this._cmapName = 'owrx'; this._dirty = true;
        }

        // visible range changed (zoom / pan)?  -> rebuild texture (throttled)
        var vis = this._visibleBins();
        if (Math.abs(vis.b0 - this._range.b0) > 1e-6 || Math.abs(vis.b1 - this._range.b1) > 1e-6) {
            if (now - this._lastRebuild > 60 || this._range.b0 < 0) {
                this._range.b0 = vis.b0; this._range.b1 = vis.b1;
                this._rebuild = true;
            }
        }
        if (this._rebuild) { this._rebuildTexture(); this._lastRebuild = now; this._dirty = true; }

        // levels (also continuous auto mode) — mapped in the shader
        var lv = (window.Waterfall && Waterfall.getRange) ? Waterfall.getRange() : { min: -150, max: 0 };
        if (lv.min !== this._lvMin || lv.max !== this._lvMax) { this._lvMin = lv.min; this._lvMax = lv.max; this._dirty = true; }

        if (!this._dirty && !this._newData) return;
        this._dirty = false; this._newData = false;
        this._lastDraw = now;

        var w = this.canvas.width, h = this.canvas.height, aspect = w / h;
        var sz = s.baseHeight * s.heightScale;
        var mats = g.computeMatrices(this.view, aspect, sz);
        this._mvp = mats.mvp;

        // tuning marker
        var marker = null;
        if (s.showMarker && vis.f1 > vis.f0) {
            var demod = null;
            try { demod = (window.UI && UI.getDemodulator) ? UI.getDemodulator() : null; } catch (e) { demod = null; }
            if (demod && typeof demod.get_offset_frequency === 'function') {
                var f = center_freq + demod.get_offset_frequency(), bw = vis.f1 - vis.f0;
                var x = (f - vis.f0) / bw;
                if (x >= 0 && x <= 1) {
                    marker = { x: x, lo: null, hi: null };
                    if (typeof demod.low_cut === 'number' && typeof demod.high_cut === 'number') {
                        marker.lo = Math.max(0, (f + demod.low_cut - vis.f0) / bw);
                        marker.hi = Math.min(1, (f + demod.high_cut - vis.f0) / bw);
                    }
                }
            }
        }

        g.render({
            mvp: mats.mvp, normal: mats.normal, light: mats.light,
            style: s.style,
            textureOffset: (this._pos % g.rows) / g.rows,
            rot: s.invert ? 1.0 : -1.0,
            levelMin: lv.min, levelMax: lv.max, linear: !!s.linear,
            showFrame: s.showFrame, marker: marker, dpr: this._dpr || 1
        });

        if (s.showLabels) this._updateLabels(mats.mvp, vis);
    };

    P._updateLabels = function (mvp, vis) {
        var g = this.gl3d;
        var cw = this.$wrap[0].clientWidth;
        var ch = this.$wrap[0].clientHeight;
        var yNew = this.settings.invert ? 1 : 0;
        var yOld = 1 - yNew;

        var place = function (id, pt, text, anchor) {
            var el = document.getElementById(id);
            if (!el) return;

            if (!pt || pt[0] < -200 || pt[0] > cw + 200 ||
                pt[1] < -100 || pt[1] > ch + 100) {
                el.style.display = 'none';
                return;
            }

            el.style.display = '';
            el.textContent = text;
            el.style.left = Math.round(pt[0]) + 'px';
            el.style.top = Math.round(pt[1]) + 'px';
            el.style.transform = anchor;
        };

        place(
            'dnx3d-lbl-f0',
            g.project(mvp, 0, 0, 0, cw, ch),
            fmtFreq(vis.f0),
            'translate(0,6px)'
        );

        place(
            'dnx3d-lbl-f1',
            g.project(mvp, 1, 0, 0, cw, ch),
            fmtFreq(vis.f1),
            'translate(-100%,6px)'
        );

        place(
            'dnx3d-lbl-now',
            g.project(mvp, 0, yNew, 0, cw, ch),
            'now',
            'translate(-100%,-50%) translateX(-6px)'
        );

        place(
            'dnx3d-lbl-old',
            g.project(mvp, 0, yOld, 0, cw, ch),
            fmtTime(this._rows * this._interval),
            'translate(-100%,-50%) translateX(-6px)'
        );

        // LIVE_OPENWEBRX_SCALE:
        // exakt dieselbe sichtbare Frequenzspanne und Schrittweitenlogik
        // wie die vorhandene OpenWebRX-Skala.
        var scale = document.getElementById('dnx3d-freqscale');

        if (!scale) return;

        scale.textContent = '';
        scale.style.position = 'absolute';
        scale.style.left = '0';
        scale.style.top = '0';
        scale.style.width = '100%';
        scale.style.height = '100%';
        scale.style.pointerEvents = 'none';
        scale.style.zIndex = '20';

        var getRange = window.get_visible_freq_range;
        var getSpacing = window.get_scale_mark_spacing;

        if (typeof getRange !== 'function' ||
            typeof getSpacing !== 'function') return;

        var range = getRange();
        if (!range) return;

        var bw = range.bw || (range.end - range.start);
        if (!(bw > 0)) return;

        var spacing = getSpacing(range);
        if (!spacing || !spacing.smallbw ||
            !spacing.params) return;

        var smallBw = spacing.smallbw;
        var largeBw = spacing.params.large_marker_per_hz;
        var first = Math.ceil(range.start / smallBw) * smallBw;

        var formatFrequency = function (f) {
            if (typeof window.format_frequency === 'function') {
                return window.format_frequency(
                    spacing.params.format,
                    f,
                    spacing.params.pre_divide,
                    spacing.params.decimals
                );
            }
            return String(Math.round(f));
        };

        var edges = [
            { y: yNew, upper: false },
            { y: yOld, upper: true }
        ];

        for (var ei = 0; ei < edges.length; ei++) {
            var edge = edges[ei];
            var guard = 0;

            for (
                var f = first;
                f <= range.end + smallBw * 0.5 && guard < 10000;
                f += smallBw, guard++
            ) {
                var rel = (f - range.start) / bw;
                if (rel < -0.02 || rel > 1.02) continue;

                var point = g.project(mvp, rel, edge.y, 0, cw, ch);
                if (!point) continue;

                var major = Math.abs(
                    f / largeBw - Math.round(f / largeBw)
                ) < 0.000001;

                var tick = document.createElement('div');
                tick.style.position = 'absolute';
                tick.style.left = Math.round(point[0]) + 'px';
                tick.style.top = Math.round(point[1]) + 'px';
                tick.style.width = major ? '3px' : '2px';
                tick.style.height = major ? '11px' : '8px';
                tick.style.background = 'rgba(255,255,255,0.95)';
                tick.style.transform = 'translateX(-50%)';
                scale.appendChild(tick);

                if (major) {
                    var label = document.createElement('span');
                    label.textContent = formatFrequency(f);
                    label.style.position = 'absolute';
                    label.style.left = Math.round(point[0]) + 'px';
                    label.style.top = Math.round(
                        point[1] + (edge.upper ? -22 : 9)
                    ) + 'px';
                    label.style.transform = 'translateX(-50%)';
                    label.style.whiteSpace = 'nowrap';
                    label.style.color = '#ffffff';
                    label.style.font = 'bold 11px sans-serif';
                    label.style.textShadow =
                        '0 1px 2px #000, 1px 0 2px #000';
                    scale.appendChild(label);
                }
            }
        }
    };

    // ---- mouse / touch / keyboard (GLSpectrumView mouse*Event) -------

    P._bindInput = function () {
        var self = this, c = this.canvas;
        var drag = null;

        c.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        c.addEventListener('mouseenter', function () { self._hover = true; });
        c.addEventListener('mouseleave', function () { self._hover = false; });

        c.addEventListener('mousedown', function (e) {
            drag = { button: e.button, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
            c.style.cursor = 'grabbing';
            e.preventDefault();
        });
        window.addEventListener('mousemove', function (e) {
            if (!drag) return;
            var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
            drag.x = e.clientX; drag.y = e.clientY;
            if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true;
            if (drag.button === 0) {            // rotate
                self.view.rotZ += dx / 2; self.view.rotX += dy / 2;
            } else if (drag.button === 1 || drag.button === 2) { // Pan: Mitte oder rechts
                self.view.tx += dx / 400;
                self.view.ty -= dy / 400;
            }
            self._dirty = true;
        });
        window.addEventListener('mouseup', function (e) {
            if (!drag) return;
            var d = drag; drag = null;
            c.style.cursor = '';
            if (d.button === 0 && !d.moved) self._clickTune(e);
            else self._save();
        });

        c.addEventListener('wheel', function (e) {
            // SDRangel: mouse wheel changes the perspective vertical angle (zoom)
            self._fov((e.deltaY > 0 ? 1 : -1) * 3);
            e.preventDefault();
            e.stopPropagation();
        }, { passive: false });

        // touch: 1 finger rotate, 2 fingers pinch = zoom, two finger drag = pan
        var touches = null;
        c.addEventListener('touchstart', function (e) {
            touches = Array.prototype.map.call(e.touches, function (t) { return { x: t.clientX, y: t.clientY }; });
            e.preventDefault();
        }, { passive: false });
        c.addEventListener('touchmove', function (e) {
            if (!touches) return;
            var cur = Array.prototype.map.call(e.touches, function (t) { return { x: t.clientX, y: t.clientY }; });
            if (cur.length === 1 && touches.length === 1) {
                self.view.rotZ += (cur[0].x - touches[0].x) / 2;
                self.view.rotX += (cur[0].y - touches[0].y) / 2;
            } else if (cur.length >= 2 && touches.length >= 2) {
                var d0 = Math.hypot(touches[0].x - touches[1].x, touches[0].y - touches[1].y);
                var d1 = Math.hypot(cur[0].x - cur[1].x, cur[0].y - cur[1].y);
                if (d0 > 0 && d1 > 0) self._fovSet(self.view.fov * d0 / d1);
                var mx0 = (touches[0].x + touches[1].x) / 2, my0 = (touches[0].y + touches[1].y) / 2;
                var mx1 = (cur[0].x + cur[1].x) / 2, my1 = (cur[0].y + cur[1].y) / 2;
                self.view.tx += (mx1 - mx0) / 400; self.view.ty -= (my1 - my0) / 400;
            }
            touches = cur;
            self._dirty = true;
            e.preventDefault();
        }, { passive: false });
        c.addEventListener('touchend', function () { touches = null; self._save(); });

        // keyboard (only while the pointer is over the 3D view)
        window.addEventListener('keydown', function (e) {
            if (!self._on || !self._hover) return;
            var t = e.target && e.target.tagName;
            if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
            var v = self.view, handled = true;
            switch (e.key) {
                case 'ArrowUp':    if (e.shiftKey) v.lightEl -= 5; else if (e.ctrlKey) v.ty += 0.05; else v.rotX -= 5; break;
                case 'ArrowDown':  if (e.shiftKey) v.lightEl += 5; else if (e.ctrlKey) v.ty -= 0.05; else v.rotX += 5; break;
                case 'ArrowLeft':  if (e.shiftKey) v.lightAz += 5; else if (e.ctrlKey) v.tx -= 0.05; else v.rotZ += 5; break;
                case 'ArrowRight': if (e.shiftKey) v.lightAz -= 5; else if (e.ctrlKey) v.tx += 0.05; else v.rotZ -= 5; break;
                case '+': case '=': if (e.ctrlKey) self._userScaleZ(1.1); else self._fov(-1); break;
                case '-':           if (e.ctrlKey) self._userScaleZ(0.9); else self._fov(1); break;
                case 'r': case 'R': self.resetView(); break;
                case ' ': case 'p': case 'P': self.setPaused(!self._paused); break;
                default: handled = false;
            }
            if (handled) { self._dirty = true; self._save(); e.preventDefault(); e.stopPropagation(); }
        }, true);
    };

    P._fov = function (delta) { this._fovSet(this.view.fov + delta); };
    P._fovSet = function (fov) { this.view.fov = Math.max(5, Math.min(150, fov)); this._dirty = true; };

    // GLShaderSpectrogram::userScaleZ
    P._userScaleZ = function (factor) {
        var s = this.settings;
        s.heightScale *= factor;
        if (s.heightScale < 0.05 && factor < 1) s.heightScale = 0;
        else if (s.heightScale === 0 && factor > 1) s.heightScale = 0.05;
        s.heightScale = Math.min(s.heightScale, 5);
        this.$wrap.find('#dnx3d-height').val(s.heightScale);
        this._dirty = true;
    };

    // click on the surface -> tune (ray / z=0 plane intersection)
    P._clickTune = function (e) {
        if (!this._mvp || !this.gl3d) return;
        var rect = this.canvas.getBoundingClientRect();
        var pt = this.gl3d.unproject(this._mvp, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
        if (!pt || pt[0] < 0 || pt[0] > 1 || pt[1] < -0.05 || pt[1] > 1.05) return;
        var vis = this._visibleBins();
        if (!(vis.f1 > vis.f0)) return;
        var f = vis.f0 + pt[0] * (vis.f1 - vis.f0);
        try {
            if (window.UI && typeof UI.setFrequency === 'function') UI.setFrequency(f);
            else if (typeof getDemodulators === 'function') {
                var d = getDemodulators()[0];
                if (d) d.set_offset_frequency(Math.round(f - center_freq));
            }
        } catch (err) { console.warn('dnx_3dtool: tune failed', err); }
    };

})(Plugins.dnx_3dtool);
