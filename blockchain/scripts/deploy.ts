import { ethers } from "hardhat";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const registry = await ethers.deployContract("PortfolioAuditRegistry");
  await registry.waitForDeployment();
  const address = await registry.getAddress();
  const output = {
    address,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString()
  };
  const outputPath = path.resolve(__dirname, "../deployment.local.json");
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { flag: "w" });
  console.log(`Contract deployed: ${address}`);
  console.log(`Deployment details: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
