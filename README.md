# aws-esm-modules-layer-support

### TLDR: Symlink your layer into your deployment package, and include the symlink (NOT the symlinked directory) into your artifact.

```javascript
symlinkSync('/opt/nodejs/node_modules', 'node_modules', 'dir')   
process.chdir(cwd)

spawnSync('zip', [
    '--symlinks', '-r', `${artifactDirectory}/function.zip`, `.`
],{
    cwd: functionPath,
    encoding: 'utf-8'
})
```


## Background 


In early 2022, AWS released ES Module support for the the Node.js 14.x Lambda Runtime.

To enable the ES Module support you simply have to include a `package.json` in your deployment with `type` set to `module` or simply use the `.mjs` extension.

[Using Node.js ES modules and top-level await in AWS Lambda](https://aws.amazon.com/blogs/compute/using-node-js-es-modules-and-top-level-await-in-aws-lambda/)

## Problem

Surprisingly, ES Module support was released without "support" for `AWS Layers`, which seems like slight oversight.

This ultimately boils down to the fact, the [module resolution algorithm](https://nodejs.org/api/esm.html#resolution-algorithm) for ES Modules does not rely on `node_path`, which results in ES Modules failing to resolve modules from `node_modules`.

A couple of goto suggestions that immediately come to mind...

- Using a bundler
- Include node_modules directly in the deployment package

Both of these alternatives resolve around NOT using layers, however that introduces the limitions layers are used for. 
- Lack of sharability
- Deployment package size limition
- Console "file is too big to edit" errors
- etc

## Solution

Here's the thing, it's node.js all the way down. After I decompiled the [AWS Lambda Runtime](https://hub.docker.com/r/amazon/aws-lambda-nodejs) and reading the AWS specific code that bootstraps the environment, it's clear that all that needs to happen is for AWS Layer to provide additional [Layer Paths](https://docs.aws.amazon.com/lambda/latest/dg/configuration-layers.html) for the node.js environment. 

Currently the bootstrap scripts that run before your lambda handler add the supported Layer paths into the `node_path` but instead what we need is the ability for `node_modules` to be mounted within the direct hireachy of the function code, since the module resolution alogrithm will look up `node_modules` starting at the function directory and work it's way up until it reaches the server root `/`.

Working around the current limition is as simple as symlinking the layer path into your function directory.

This is accomplished at your build/deployment step when generating your zip artifact that is uploaded to AWS.

1. Bundle your `node_modules` into a layer as normal
2. Create a symlink in your source code directory that points to whichever runtime Layer Path you are using ( `/opt/nodejs/node_modules` or `/opt/nodejs/node14/node_modules`)
3. Zip up your source code and include the symlink
4. Distribute your ZIP as normal

During runtime, the symlink will essentially act as a proxy to your layer.

Tada! ezpz. 

I use `cdk` in my projects, so here's an snippet extract from my construct that creates AWS Lambda resources.

```javascript
        const dir = dirname(require.resolve('@whoami/sample-function'))
        const packageJson = join(dir, 'package.json')

        const directory = new Directory(this, 'directory', {
            baseDir: dir
        })

        const pkg = JSON.parse(readFileSync(packageJson, { encoding: 'utf-8' }))
        const packageName = pkg.name.replace('@', '').replace('/', '_')
        const artifactName = `${packageName}-${directory.digests.md5}`
        const artifactDirectory = resolve(`cdktf.out/artifacts/${artifactName}`)

        const packageJsonExists = existsSync(packageJson)
        const tmp = mkdtempSync(join(tmpdir(), packageName))

        if (packageJsonExists) {
            const dependencyPath = join(tmp, 'nodejs')

            mkdirSync(dependencyPath)
            copyFileSync(packageJson, join(dependencyPath, 'package.json'))


            spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--prod'], {
                cwd: dependencyPath
            })


            const dependencyArtifact = new AdmZip()
            dependencyArtifact.addLocalFolder(dependencyPath, 'nodejs')
            dependencyArtifact.writeZip(join(artifactDirectory, 'layer.zip'))

        }

        const functionPath = join(tmp, 'function')

        buildSync({
            entryPoints: [
                config.code
            ],
            bundle: true,
            external: packageJson ? Object.keys(pkg.dependencies) : [],
            outdir: functionPath,
            target: ['es2022'],
            format: 'esm',
            platform: 'node'
        })

        let cwd = process.cwd()
        process.chdir(functionPath)

        symlinkSync('/opt/nodejs/node_modules', 'node_modules', 'dir')   
        process.chdir(cwd)
        
        spawnSync('zip', [
            '--symlinks', '-r', `${artifactDirectory}/function.zip`, `.`
        ],{
            cwd: functionPath,
            encoding: 'utf-8'
        } )

        process.chdir(cwd)


        rmSync(tmp, { recursive: true })

```


## Other known workarounds.


[Markus Tacker](https://twitter.com/coderbyheart/status/1487218393241563140) has an neat workaround which involves using dynamic async imports to load the modules from the layer. 

You find his example solution here.[AWS Lambda ESM with Layer](https://github.com/coderbyheart/aws-lambda-esm-with-layer)

The downside to Tacker's solution is that you must include this boiler plate directly in every source file which can become a hassle.

If you practice Infrastructure as Code, it's very easy to symlink the layer without each function having to be explicitly aware of the workaround.




