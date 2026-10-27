import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("PortfolioAuditRegistry", function () {
  async function deploy() {
    const [owner, writer, stranger] = await ethers.getSigners();
    const deployed = await ethers.deployContract("PortfolioAuditRegistry");
    await deployed.waitForDeployment();
    const registry = await ethers.getContractAt("PortfolioAuditRegistry", await deployed.getAddress());
    return { registry, owner, writer, stranger };
  }

  const hash = (value: string) => ethers.keccak256(ethers.toUtf8Bytes(value));

  it("sets the deployer as owner and an authorized writer", async function () {
    const { registry, owner } = await deploy();
    expect(await registry.getFunction("owner").staticCall()).to.equal(owner.address);
    expect(await registry.getFunction("authorizedWriters").staticCall(owner.address)).to.equal(true);
  });

  it("records an audit entry and emits its fields", async function () {
    const { registry, owner } = await deploy();
    const values = [hash("id"), hash("portfolio"), hash("data"), hash("asset"), 1] as const;
    await expect(registry.getFunction("recordTransaction").send(...values))
      .to.emit(registry, "TransactionRecorded")
      .withArgs(...values, anyValue);
    const result = await registry.getFunction("getRecord").staticCall(values[0]);
    expect(result.dataHash).to.equal(values[2]);
    expect(result.exists).to.equal(true);
    expect(await registry.connect(owner).getFunction("recordExists").staticCall(values[0])).to.equal(true);
  });

  it("allows an authorized writer and rejects other addresses", async function () {
    const { registry, writer, stranger } = await deploy();
    await registry.getFunction("setWriter").send(writer.address, true);
    await expect(registry.connect(writer).getFunction("recordTransaction").send(hash("id"), hash("p"), hash("d"), hash("a"), 2))
      .to.emit(registry, "TransactionRecorded");
    await expect(registry.connect(stranger).getFunction("recordTransaction").send(hash("id2"), hash("p"), hash("d"), hash("a"), 1))
      .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
      .withArgs(stranger.address, await registry.getFunction("WRITER_ROLE").staticCall());
  });

  it("rejects duplicate IDs, zero hashes, and invalid actions", async function () {
    const { registry } = await deploy();
    const values = [hash("id"), hash("portfolio"), hash("data"), hash("asset"), 1] as const;
    await registry.getFunction("recordTransaction").send(...values);
    await expect(registry.getFunction("recordTransaction").send(...values)).to.be.revertedWithCustomError(registry, "DuplicateTransaction");
    await expect(registry.getFunction("recordTransaction").send(ethers.ZeroHash, values[1], values[2], values[3], 1))
      .to.be.revertedWithCustomError(registry, "InvalidInput");
    await expect(registry.getFunction("recordTransaction").send(hash("id2"), values[1], values[2], values[3], 3))
      .to.be.revertedWithCustomError(registry, "InvalidInput");
  });

  it("keeps records readable after later writes and rejects non-owner writer changes", async function () {
    const { registry, stranger } = await deploy();
    const id = hash("first");
    await registry.getFunction("recordTransaction").send(id, hash("p"), hash("d"), hash("a"), 1);
    await registry.getFunction("recordTransaction").send(hash("second"), hash("p2"), hash("d2"), hash("a2"), 2);
    expect((await registry.getFunction("getRecord").staticCall(id)).exists).to.equal(true);
    expect((await registry.connect(stranger).getFunction("getRecord").staticCall(id)).exists).to.equal(true);
    expect(await registry.connect(stranger).getFunction("recordExists").staticCall(id)).to.equal(true);
    await expect(registry.connect(stranger).getFunction("setWriter").send(stranger.address, true))
      .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount")
      .withArgs(stranger.address);
  });
});
